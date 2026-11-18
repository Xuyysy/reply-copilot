import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fixture,temp} from './helpers/payment-v2.mjs';

buildSync({entryPoints:[new URL('../src/quota.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:temp+'/subscription-quota.cjs'});
const {reserveGeneration,finishGeneration,releaseExpiredDeliveryReservations}=createRequire(import.meta.url)(temp+'/subscription-quota.cjs');
const DAY=86400000,session={user_id:'test-user',kind:'extension'};
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const reserve=(f,n)=>reserveGeneration(f.env,session,id(n),'hash-'+n,100);
function setup(f,{plan='basic',used=0,reserved=0,paid=0}={}){
 f.env.SUBSCRIPTIONS_ENABLED='1';
 const now=Date.now(),start=now-2*DAY-10000,price={basic:6990,pro:11990,max:17990,ultra:25990}[plan],limit={basic:500,pro:1000,max:1500,ultra:2000}[plan];
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('sub-order','test-user',?,'purchase',?,'paid',1,9999999999999,1,1,?,?)").run(plan+'-v1',price,now,now);
 f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at) VALUES('sub-txn','sub-order','local_mock','sub-trade','LOCAL_MOCK',?,'paid','clear',1,1,?)").run(price,now);
 f.sql.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('sub-event','sub-txn','local_mock','sub-event-key','PAYMENT_SUCCEEDED',?,?)").run(price,now);
 f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('sub-period','test-user','sub-order',? ,?,'active',?,?,1,1)").run(plan+'-v1',limit,start,start+30*DAY);
 if(used||reserved)f.sql.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('sub-period',2,?,?,?)").run(used,reserved,now);
 if(paid)f.sql.prepare("UPDATE credit_accounts SET paid_balance=?").run(paid);
 if(paid)f.sql.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,granted_at,history_confidence,status) VALUES('paid-batch','test-user','paid','legacy_paid',?,?,1,'tracked','active')").run(paid,paid);
 return {now,start,limit};
}
const daily=f=>f.sql.prepare("SELECT used,reserved FROM subscription_daily_usage WHERE period_id='sub-period' AND day_index=2").get();
async function ack(f,n){
 f.sql.exec("UPDATE sessions SET kind='extension'");
 return f.call('/v1/ai/requests/'+id(n)+'/delivered',{headers:{Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN},body:{requestId:id(n)}});
}
test('subscription reserves in an independent daily bucket and ACK debits once',async()=>{
 const f=fixture();try{
   setup(f,{plan:'pro'});
   assert.equal((await reserve(f,1)).kind,'new');
   assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(1)).credit_source,null);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM ai_credit_allocations").get().n,0);
   assert.equal(f.sql.prepare("SELECT state FROM subscription_ai_allocations").get().state,'reserved');
   assert.deepEqual({...daily(f)},{used:0,reserved:1});
   assert.equal(f.sql.prepare("SELECT free_generation_reserved,free_balance FROM credit_accounts").get().free_generation_reserved,0);
   await finishGeneration(f.env,'test-user',id(1),'three drafts',{model:'mock',inputTokens:1,outputTokens:3,costMicroUsd:10});
   const ok=await ack(f,1);
   assert.equal(ok.status,200,JSON.stringify(ok.body));
   assert.equal(ok.body.alreadyConfirmed,false);
   assert.equal(ok.body.subscription.remainingToday,999);
   const replay=await ack(f,1);
   assert.equal(replay.status,200);assert.equal(replay.body.alreadyConfirmed,true);
   assert.deepEqual({...daily(f)},{used:1,reserved:0});
   assert.equal(f.sql.prepare("SELECT state FROM subscription_ai_allocations").get().state,'consumed');
   assert.equal(f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts").get().free_balance,200);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,0);
   assert.deepEqual(f.sql.prepare("SELECT event_type FROM subscription_usage_events ORDER BY created_at,event_type").all().map(x=>x.event_type).sort(),['consume','reserve']);
 }finally{f.sql.close();}
});

test('failed provider release restores its original daily reservation, not free balance',async()=>{
 const f=fixture();try{
   setup(f);await reserve(f,2);
   await finishGeneration(f.env,'test-user',id(2),null,{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:20});
   assert.deepEqual({...daily(f)},{used:0,reserved:0});
   assert.equal(f.sql.prepare("SELECT state FROM subscription_ai_allocations").get().state,'released');
   assert.equal(f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts").get().free_balance,200);
   assert.equal(f.sql.prepare("SELECT reserved_micro_usd FROM ai_budget_days").get().reserved_micro_usd,0);
   assert.equal(f.sql.prepare("SELECT settled_micro_usd FROM ai_budget_days").get().settled_micro_usd,20);
   await finishGeneration(f.env,'test-user',id(2),null);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_usage_events WHERE event_type='release'").get().n,1);
 }finally{f.sql.close();}
});

test('stale unfinished generation releases subscription reservation and conservatively settles budget',async()=>{
 const f=fixture();try{
   setup(f);await reserve(f,3);
   f.sql.prepare("UPDATE ai_requests SET created_at=? WHERE request_id=?").run(Date.now()-11*60000,id(3));
   await releaseExpiredDeliveryReservations(f.env,Date.now(),'test-user');
   assert.equal(f.sql.prepare("SELECT status FROM ai_requests WHERE request_id=?").get(id(3)).status,'upstream_failed');
   assert.deepEqual({...daily(f)},{used:0,reserved:0});
   assert.equal(f.sql.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days").get().settled_micro_usd,100);
   await releaseExpiredDeliveryReservations(f.env,Date.now(),'test-user');
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_usage_events WHERE event_type='release'").get().n,1);
 }finally{f.sql.close();}
});

test('explicit authenticated abandon releases a recent in-flight subscription generation once',async()=>{
 const f=fixture();try{
   setup(f);await reserve(f,61);
   f.sql.exec("UPDATE sessions SET kind='extension'");
   const headers={Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN};
   const r=await f.call('/v1/ai/requests/'+id(61)+'/abandon',{headers,body:{requestId:id(61)}});
   assert.equal(r.status,200,JSON.stringify(r.body));
   assert.equal(r.body.state,'released');
   assert.deepEqual({...daily(f)},{used:0,reserved:0});
   assert.equal(f.sql.prepare("SELECT status FROM ai_requests WHERE request_id=?").get(id(61)).status,'upstream_failed');
   assert.equal(f.sql.prepare("SELECT reserved_micro_usd,settled_micro_usd FROM ai_budget_days").get().settled_micro_usd,100);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_usage_events WHERE event_type='release'").get().n,1);
 }finally{f.sql.close();}
});

test('expired awaiting-delivery response releases only subscription reservation and does not double-settle cost',async()=>{
 const f=fixture();try{
   setup(f);await reserve(f,4);
   await finishGeneration(f.env,'test-user',id(4),'reply',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:25});
   f.sql.prepare("UPDATE ai_requests SET response_expires_at=? WHERE request_id=?").run(Date.now()-1000,id(4));
   await releaseExpiredDeliveryReservations(f.env,Date.now(),'test-user');
   assert.deepEqual({...daily(f)},{used:0,reserved:0});
   assert.equal(f.sql.prepare("SELECT settled_micro_usd FROM ai_budget_days").get().settled_micro_usd,25);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_usage_events WHERE event_type='release'").get().n,1);
   assert.equal((await ack(f,4)).status,409);
 }finally{f.sql.close();}
});

test('daily 500/1000/1500/2000 limits fall back to welcome free credits before permanent paid credits',async()=>{
 for(const [i,plan,limit] of [['basic',500],['pro',1000],['max',1500],['ultra',2000]].map(([p,l],i)=>[i,p,l])){
   const f=fixture();try{
     setup(f,{plan,used:limit-1,paid:2});
     await reserve(f,10+i);
     assert.deepEqual({...daily(f)},{used:limit-1,reserved:1});
     await finishGeneration(f.env,'test-user',id(10+i),'reply',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     assert.equal((await ack(f,10+i)).status,200);
     assert.equal(daily(f).used,limit);
     assert.equal((await reserve(f,20+i)).kind,'new');
     assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(20+i)).credit_source,'free');
     await finishGeneration(f.env,'test-user',id(20+i),'fallback',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     assert.equal((await ack(f,20+i)).status,200);
     assert.equal(f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts").get().free_balance,199);
     assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts").get().paid_balance,2);
     assert.equal(daily(f).used,limit,'welcome credit ACK must not overrun subscribed daily cap');
   }finally{f.sql.close();}
 }
});

test('subscription overage uses free balance before any separately purchased permanent credits',async()=>{
 const f=fixture();try{
   setup(f,{used:500,paid:2});
   assert.equal((await reserve(f,30)).kind,'new');
   assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(30)).credit_source,'free');
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_ai_allocations").get().n,0);
   await finishGeneration(f.env,'test-user',id(30),'reply',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
   assert.equal((await ack(f,30)).status,200);
   assert.equal(f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts").get().free_balance,199);
   assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts").get().paid_balance,2);
   assert.equal((await ack(f,30)).body.alreadyConfirmed,true);
   assert.equal(f.sql.prepare("SELECT free_balance FROM credit_accounts").get().free_balance,199);
 }finally{f.sql.close();}
});

test('permanent credits are used only after both daily subscription and free balances are exhausted',async()=>{
 const f=fixture();try{
   setup(f,{used:500,paid:2});
   f.sql.exec("UPDATE credit_batches SET remaining_credits=0,consumed_credits=grant_credits WHERE bucket='free'; UPDATE credit_accounts SET free_balance=0");
   assert.equal((await reserve(f,31)).kind,'new');
   assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(31)).credit_source,'paid');
   await finishGeneration(f.env,'test-user',id(31),'reply',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
   assert.equal((await ack(f,31)).status,200);
   assert.deepEqual({...f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts").get()},{free_balance:0,paid_balance:1});
   assert.equal(daily(f).used,500);
 }finally{f.sql.close();}
});

test('exhausted subscription with no free or permanent credits denies a new generation',async()=>{
 const f=fixture();try{
   setup(f,{used:500});
   f.sql.exec("UPDATE credit_batches SET remaining_credits=0,consumed_credits=grant_credits WHERE bucket='free'; UPDATE credit_accounts SET free_balance=0");
   await assert.rejects(reserve(f,32),err=>err.code==='INSUFFICIENT_CREDITS');
   assert.equal(f.sql.prepare("SELECT count(*) n FROM ai_credit_allocations").get().n,0);
 }finally{f.sql.close();}
});

test('concurrent reservation calls can start at most one active model generation',async()=>{
 const f=fixture();try{
   setup(f);
   const result=await Promise.allSettled([reserve(f,41),reserve(f,42)]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,1,JSON.stringify(result.map(r=>r.status)));
   assert.equal(daily(f).reserved,1);
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_ai_allocations").get().n,1);
 }finally{f.sql.close();}
});

test('inconsistent subscription day counters force full transaction rollback',async()=>{
 const f=fixture();try{
   setup(f,{used:500});
   await assert.rejects(async()=>f.sql.prepare("UPDATE subscription_daily_usage SET reserved=1 WHERE period_id='sub-period'").run());
   assert.deepEqual({...daily(f)},{used:500,reserved:0});
 }finally{f.sql.close();}
});

test('production ignores locally mocked subscription proof, preserving free legacy path',async()=>{
 const f=fixture();try{
   setup(f);f.env.ENVIRONMENT='production';
   const result=await reserve(f,51);
   assert.equal(result.kind,'new');
   assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(51)).credit_source,'free');
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_ai_allocations").get().n,0);
 }finally{f.sql.close();}
});

test('0.3.5 wire path receives three candidates and never recaches exhausted permanent quota on a subscription ACK',async()=>{
 const f=fixture();try{
  setup(f);
  f.sql.exec("UPDATE credit_accounts SET free_balance=0; UPDATE sessions SET kind='extension'");
  const headers={Authorization:'Bearer '+'b'.repeat(64),Origin:f.env.EXTENSION_ORIGIN};
  const requestId=id(800);
  const body={requestId,post:{text:'A public post for isolated testing.',url:'https://x.com/example/status/123'}};
  const first=await f.call('/v1/ai/generate',{headers,body});
  assert.equal(first.status,200,JSON.stringify(first.body));
  assert.deepEqual(Object.keys(JSON.parse(first.body.raw).replies).sort(),['light_humor','natural','thoughtful']);
  assert.equal(first.body.quota,undefined);
  const received=await ack(f,800);
  assert.equal(received.status,200);
  assert.equal(received.body.quota,undefined);
  assert.equal(received.body.subscription.remainingToday,499);
  assert.equal((await f.call('/v1/ai/generate',{headers,body})).body.raw,first.body.raw);
  assert.equal((await ack(f,800)).body.alreadyConfirmed,true);
  assert.equal(daily(f).used,1);
 }finally{f.sql.close();}
});


test('Production: verified BEP20 subscription is spendable via atomic reservation, never converted into free/paid credits',async()=>{
 const f=fixture();try{
  setup(f);
  f.sql.exec(readFileSync(new URL('../sql-proposals/0028_boltutil_usdt.sql',import.meta.url),'utf8'));
  f.env.ENVIRONMENT='production';
  f.env.BOLTUTIL_SCHEMA_READY='1';
  f.sql.exec("UPDATE credit_batches SET remaining_credits=0,consumed_credits=grant_credits WHERE user_id='test-user' AND bucket='free'");
  f.sql.exec("UPDATE credit_accounts SET free_balance=0 WHERE user_id='test-user'");
  f.sql.prepare("INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,subscription_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,payable_usdt_micros,paid_usdt_micros,receiving_address,tx_hash,status,paid_at,applied_at,created_at,updated_at) VALUES('crypto1','bolt-ext-1','test-user','crypto-op-1','subscription','sub-order','BEP20','0xabc',18,6990,6670000,10479761,10479761,10479761,? ,?,'paid',?,?,1,1)")
   .run('0x'+'1'.repeat(40),'0x'+'a'.repeat(64),Date.now(),Date.now());
  // A mere paid flag without independent signed provider evidence is NEVER spendable.
  await assert.rejects(reserve(f,901),err=>err.code==='INSUFFICIENT_CREDITS');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_ai_allocations").get().n,0);
  f.sql.prepare("INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) VALUES('crypto-event','bolt-ext-1','CONFIRMED','BEP20',?, 'sha256-proof',?)")
   .run('0x'+'a'.repeat(64),Date.now());
  assert.equal((await reserve(f,902)).kind,'new');
  assert.equal(f.sql.prepare("SELECT state FROM subscription_ai_allocations WHERE request_id=?").get(id(902)).state,'reserved');
  assert.deepEqual({...daily(f)},{used:0,reserved:1});
  assert.equal(f.sql.prepare("SELECT count(*) n FROM ai_credit_allocations WHERE request_id=?").get(id(902)).n,0);
  await finishGeneration(f.env,'test-user',id(902),'subscription response',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
  const receipt=await ack(f,902);
  assert.equal(receipt.status,200,JSON.stringify(receipt));
  assert.equal(receipt.body.subscription.remainingToday,499);
  assert.deepEqual({...daily(f)},{used:1,reserved:0});
  assert.equal(f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts").get().free_balance,0);
  // Revoked payment evidence cannot authorize a NEW generation, even if the period remains active.
  f.sql.exec("DELETE FROM boltutil_payment_events");
  await assert.rejects(reserve(f,903),err=>err.code==='INSUFFICIENT_CREDITS');
  assert.deepEqual({...daily(f)},{used:1,reserved:0});
 }finally{f.sql.close();}
});

test('Production: missing crypto schema readiness, held payment and insufficient settlement all deny spend even with active period',async()=>{
 const f=fixture();try{
  setup(f);
  f.sql.exec(readFileSync(new URL('../sql-proposals/0028_boltutil_usdt.sql',import.meta.url),'utf8'));
  f.env.ENVIRONMENT='production';f.env.BOLTUTIL_SCHEMA_READY='1';
  f.sql.exec("UPDATE credit_batches SET remaining_credits=0,consumed_credits=grant_credits WHERE bucket='free'; UPDATE credit_accounts SET free_balance=0");
  const now=Date.now();
  f.sql.prepare("INSERT INTO boltutil_orders(id,external_order_id,user_id,operation_id,product_type,subscription_order_id,network,token_contract,token_decimals,base_amount_fen,cny_per_usdt_micros,quoted_usdt_micros,payable_usdt_micros,paid_usdt_micros,receiving_address,tx_hash,status,paid_at,applied_at,created_at,updated_at) VALUES('crypto2','bolt-ext-2','test-user','crypto-op-2','subscription','sub-order','BEP20','0xabc',18,6990,6670000,10479761,10479761,10479761,?,?,'paid',?,?,1,1)")
    .run('0x'+'1'.repeat(40),'0x'+'b'.repeat(64),now,now);
  f.sql.prepare("INSERT INTO boltutil_payment_events(event_id,external_order_id,status,network,tx_hash,body_sha256,received_at) VALUES('crypto-event2','bolt-ext-2','CONFIRMED','BEP20',?, 'sha256-proof',?)")
    .run('0x'+'b'.repeat(64),now);
  f.env.BOLTUTIL_SCHEMA_READY='0';
  await assert.rejects(reserve(f,904),err=>err.code==='INSUFFICIENT_CREDITS');
  f.env.BOLTUTIL_SCHEMA_READY='1';
  f.sql.exec("UPDATE boltutil_orders SET status='manual_review'");
  await assert.rejects(reserve(f,905),err=>err.code==='INSUFFICIENT_CREDITS');
  f.sql.exec("UPDATE boltutil_orders SET status='paid',paid_usdt_micros=0");
  await assert.rejects(reserve(f,906),err=>err.code==='INSUFFICIENT_CREDITS');
  f.sql.exec("UPDATE boltutil_orders SET paid_usdt_micros=payable_usdt_micros");
  f.sql.exec("UPDATE users SET status='frozen' WHERE id='test-user'");
  await assert.rejects(reserve(f,907),err=>err.code==='INSUFFICIENT_CREDITS');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_ai_allocations").get().n,0);
 }finally{f.sql.close();}
});
