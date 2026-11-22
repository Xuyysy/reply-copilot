import test from 'node:test';
import assert from 'node:assert/strict';
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

test('two independent subscription requests reserve concurrently and settle separately',async()=>{
 const f=fixture();try{
   setup(f);
   const result=await Promise.allSettled([reserve(f,41),reserve(f,42)]);
   assert.equal(result.filter(r=>r.status==='fulfilled').length,2,JSON.stringify(result.map(r=>r.status)));
   assert.deepEqual({...daily(f)},{used:0,reserved:2});
   assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_ai_allocations WHERE state='reserved'").get().n,2);
   await finishGeneration(f.env,'test-user',id(42),'second complete',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
   assert.equal((await ack(f,42)).status,200);
   assert.deepEqual({...daily(f)},{used:1,reserved:1});
   await finishGeneration(f.env,'test-user',id(41),null,{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:8});
   assert.deepEqual({...daily(f)},{used:1,reserved:0});
 }finally{f.sql.close();}
});
test('daily subscription quota still prevents parallel over-allocation',async()=>{
 const f=fixture();try{
   setup(f,{used:499});
   f.sql.exec("UPDATE credit_batches SET remaining_credits=0,consumed_credits=grant_credits WHERE bucket='free'; UPDATE credit_accounts SET free_balance=0");
   assert.equal((await reserve(f,71)).kind,'new');
   await assert.rejects(reserve(f,72),e=>e.code==='INSUFFICIENT_CREDITS');
   assert.deepEqual({...daily(f)},{used:499,reserved:1});
 }finally{f.sql.close();}
});

test('cross-source race uses one last subscription slot and one free credit, with out-of-order idempotent ACKs',async()=>{
 const f=fixture();try{
   setup(f,{used:499,paid:1});
   const attempts=await Promise.allSettled([reserve(f,91),reserve(f,92)]);
   assert.equal(attempts.filter(x=>x.status==='fulfilled').length,2,JSON.stringify(attempts.map(x=>x.status)));
   const sources=[91,92].map(n=>({n,source:f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source}));
   assert.equal(sources.filter(x=>x.source===null).length,1,'exactly one request may reserve the final subscription slot');
   assert.equal(sources.filter(x=>x.source==='free').length,1,'the other request must use a separate free lot');
   assert.deepEqual({...daily(f)},{used:499,reserved:1});
   assert.equal(f.sql.prepare("SELECT free_generation_reserved FROM credit_accounts").get().free_generation_reserved,1);
   for(const {n} of sources)await finishGeneration(f.env,'test-user',id(n),'valid response',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
   const free=sources.find(x=>x.source==='free').n,sub=sources.find(x=>x.source===null).n;
   assert.equal((await ack(f,free)).status,200);
   assert.equal((await ack(f,free)).body.alreadyConfirmed,true);
   assert.deepEqual({...daily(f)},{used:499,reserved:1},'free ACK must not consume a subscription slot');
   assert.equal((await ack(f,sub)).status,200);
   assert.equal((await ack(f,sub)).body.alreadyConfirmed,true);
   assert.deepEqual({...daily(f)},{used:500,reserved:0});
   assert.deepEqual({...f.sql.prepare("SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts").get()},{free_balance:199,paid_balance:1,free_generation_reserved:0,paid_generation_reserved:0});
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,1);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM subscription_usage_events WHERE event_type='consume'").get().n,1);
 }finally{f.sql.close();}
});

test('Staging-only subscriber-scoped five-use QA ceiling preserves paid plan proof and falls back free then paid',async()=>{
 const f=fixture();try{
   setup(f,{paid:1});
   f.sql.exec("UPDATE credit_batches SET grant_credits=1,remaining_credits=1,consumed_credits=0 WHERE id='free-batch'; UPDATE credit_accounts SET free_balance=1 WHERE user_id='test-user'");
   f.env.STAGING_QA_SUBSCRIPTION_FIVE='1';
   f.env.STAGING_QA_SUBSCRIPTION_USER_ID='other-account';
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,500,'override must never affect another subscriber');
   f.env.STAGING_QA_SUBSCRIPTION_USER_ID='test-user';
   let state=await f.call('/v1/usage',{method:'GET'});
   assert.equal(state.body.subscription.dailyLimit,5);
   assert.equal(state.body.subscription.remainingToday,5);
   assert.equal(f.sql.prepare("SELECT daily_limit FROM subscription_periods WHERE id='sub-period'").get().daily_limit,500,'purchased subscription stays 500/day in D1');
   for(let i=1;i<=5;i++){
     const n=700+i;
     assert.equal((await reserve(f,n)).kind,'new');
     assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source,null);
     await finishGeneration(f.env,'test-user',id(n),'valid draft',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     const result=await ack(f,n);
     assert.equal(result.status,200,JSON.stringify(result.body));
     assert.equal(result.body.subscription.remainingToday,5-i);
     assert.equal((await ack(f,n)).body.alreadyConfirmed,true);
   }
   f.sql.exec("UPDATE sessions SET kind='web'");
   state=await f.call('/v1/usage',{method:'GET'});
   assert.equal(state.body.subscription.remainingToday,0);
   assert.equal(state.body.quota.freeRemaining,1);
   assert.equal(state.body.quota.paidRemaining,1);
   for(const [n,source] of [[706,'free'],[707,'paid']]){
     assert.equal((await reserve(f,n)).kind,'new');
     assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source,source);
     await finishGeneration(f.env,'test-user',id(n),'valid fallback',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     assert.equal((await ack(f,n)).status,200);
   }
   f.sql.exec("UPDATE sessions SET kind='web'");
   assert.equal((await f.call('/v1/entitlements',{method:'GET'})).body.status,'credits_exhausted');
   await assert.rejects(reserve(f,708),e=>e.code==='INSUFFICIENT_CREDITS');
   assert.deepEqual({...daily(f)},{used:5,reserved:0});
   assert.equal(f.sql.prepare("SELECT daily_limit FROM subscription_periods WHERE id='sub-period'").get().daily_limit,500);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM subscription_usage_events WHERE event_type='consume'").get().n,5);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,2);
   f.env.STAGING_QA_SUBSCRIPTION_FIVE='0';
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,495,'disabling QA must restore actual paid entitlement without corrupting ledger');
 }finally{f.sql.close();}
});

test('Staging QA five-use cap still enforces atomic final subscription slot with concurrent free and paid',async()=>{
 const f=fixture();try{
   setup(f,{used:4,paid:1});
   f.sql.exec("UPDATE credit_batches SET grant_credits=1,remaining_credits=1,consumed_credits=0 WHERE id='free-batch'; UPDATE credit_accounts SET free_balance=1 WHERE user_id='test-user'");
   f.env.STAGING_QA_SUBSCRIPTION_FIVE='1';
   f.env.STAGING_QA_SUBSCRIPTION_USER_ID='test-user';
   const ns=[751,752,753];
   const attempted=await Promise.allSettled(ns.map(n=>reserve(f,n)));
   assert.equal(attempted.filter(x=>x.status==='fulfilled').length,3,JSON.stringify(attempted.map(x=>x.status==='rejected'?x.reason?.code:'ok')));
   const sources=ns.map(n=>({n,source:f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source}));
   assert.deepEqual(sources.map(x=>x.source??'subscription').sort(),['free','paid','subscription']);
   assert.deepEqual({...daily(f)},{used:4,reserved:1});
   for(const {n} of [...sources].reverse()){
     await finishGeneration(f.env,'test-user',id(n),'valid draft',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     assert.equal((await ack(f,n)).status,200);
     assert.equal((await ack(f,n)).body.alreadyConfirmed,true);
   }
   assert.deepEqual({...daily(f)},{used:5,reserved:0});
   assert.deepEqual({...f.sql.prepare('SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts').get()},{free_balance:0,paid_balance:0,free_generation_reserved:0,paid_generation_reserved:0});
   await assert.rejects(reserve(f,754),e=>e.code==='INSUFFICIENT_CREDITS');
 }finally{f.sql.close();}
});

test('Staging five-use selector safely targets unique username yyx13 only with verified subscription',async()=>{
 const f=fixture();try{
   setup(f);
   f.sql.exec("UPDATE users SET username='yyx13' WHERE id='test-user'");
   f.env.STAGING_QA_SUBSCRIPTION_FIVE='1';
   f.env.STAGING_QA_SUBSCRIPTION_USERNAME='YYX13';
   f.env.STAGING_QA_SUBSCRIPTION_USER_ID=undefined;
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,5,'unique username matches case-insensitively');
   f.env.STAGING_QA_SUBSCRIPTION_USERNAME='another-user';
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,500,'nonmatching username cannot be affected');
   f.env.STAGING_QA_SUBSCRIPTION_USERNAME='yyx13';
   f.env.STAGING_QA_SUBSCRIPTION_USER_ID='some-other-id';
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,500,'ID selector wins; no fallback to alternate username');
   f.env.STAGING_QA_SUBSCRIPTION_USER_ID=undefined;
   f.env.STAGING_QA_SUBSCRIPTION_FIVE='0';
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,500,'disabled flag must leave real plan unchanged');
   f.env.STAGING_QA_SUBSCRIPTION_FIVE='1';
   // Prove username selection applies to an actual atomic subscription reservation and ACK.
   assert.equal((await reserve(f,799)).kind,'new');
   assert.deepEqual({...daily(f)},{used:0,reserved:1});
   await finishGeneration(f.env,'test-user',id(799),'QA username target',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
   assert.equal((await ack(f,799)).status,200);
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.remainingToday,4);
   assert.deepEqual({...daily(f)},{used:1,reserved:0});
   assert.equal(f.sql.prepare("SELECT daily_limit FROM subscription_periods WHERE id='sub-period'").get().daily_limit,500,'no payment plan mutation');
 }finally{f.sql.close();}
});

test('STAGING QA five-subscription-use walkthrough falls back to one free, one paid, then purchase required',async()=>{
 const f=fixture();try{
   setup(f,{used:495,paid:1});
   // In-memory Staging fixture ONLY. Real subscription CHECK allows only 500/1000/1500/2000.
   // A legitimate 500/day paid period with 495 used has exactly FIVE remaining for QA.
   f.sql.exec("UPDATE credit_batches SET grant_credits=1,remaining_credits=1,consumed_credits=0 WHERE id='free-batch'; UPDATE credit_accounts SET free_balance=1 WHERE user_id='test-user'");
   for(let i=1;i<=5;i++){
     const n=900+i;
     assert.equal((await reserve(f,n)).kind,'new');
     assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source,null,'first five uses must be subscription');
     assert.deepEqual({...daily(f)},{used:494+i,reserved:1});
     await finishGeneration(f.env,'test-user',id(n),'draft '+i,{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     const settled=await ack(f,n);
     assert.equal(settled.status,200,JSON.stringify(settled.body));
     assert.equal(settled.body.subscription.dailyLimit,500,'original paid plan remains unchanged');
     assert.equal(settled.body.subscription.remainingToday,5-i);
     assert.deepEqual({...daily(f)},{used:495+i,reserved:0});
   }
   f.sql.exec("UPDATE sessions SET kind='web'");
   let status=await f.call('/v1/usage',{method:'GET'});
   assert.equal(status.status,200);
   assert.equal(status.body.subscription.remainingToday,0);
   assert.equal(status.body.quota.freeRemaining,1);
   assert.equal(status.body.quota.paidRemaining,1);
   assert.equal(status.body.availableNow,2);
   for(const [n,source] of [[906,'free'],[907,'paid']]){
     assert.equal((await reserve(f,n)).kind,'new');
     assert.equal(f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source,source);
     await finishGeneration(f.env,'test-user',id(n),'next draft',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     assert.equal((await ack(f,n)).status,200);
     assert.equal((await ack(f,n)).body.alreadyConfirmed,true,'duplicate ACK must not consume again');
   }
   f.sql.exec("UPDATE sessions SET kind='web'");
   status=await f.call('/v1/usage',{method:'GET'});
   assert.equal(status.status,200);
   assert.equal(status.body.availableNow,0);
   assert.deepEqual({...status.body.quota},{freeRemaining:0,paidRemaining:0,totalRemaining:0});
   assert.equal(status.body.subscription.remainingToday,0);
   const entitlement=await f.call('/v1/entitlements',{method:'GET'});
   assert.equal(entitlement.body.status,'credits_exhausted');
   await assert.rejects(reserve(f,908),error=>error.code==='INSUFFICIENT_CREDITS');
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM subscription_usage_events WHERE event_type='consume'").get().n,5);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,2);
 }finally{f.sql.close();}
});

test('STAGING QA five-use cap cannot overbook last slot; concurrent overflow reserves free then paid exactly once',async()=>{
 const f=fixture();try{
   setup(f,{used:499,paid:1});
   // Keep legitimate 500/day DB invariant; 499 used leaves the final 1 of five test uses.
   f.sql.exec("UPDATE credit_batches SET grant_credits=1,remaining_credits=1,consumed_credits=0 WHERE id='free-batch'; UPDATE credit_accounts SET free_balance=1 WHERE user_id='test-user'");
   const ns=[941,942,943];
   const outcomes=await Promise.allSettled(ns.map(n=>reserve(f,n)));
   assert.equal(outcomes.filter(o=>o.status==='fulfilled').length,3,JSON.stringify(outcomes.map(o=>o.status==='rejected'?o.reason?.code:'ok')));
   const sources=ns.map(n=>({n,source:f.sql.prepare("SELECT credit_source FROM ai_requests WHERE request_id=?").get(id(n)).credit_source}));
   assert.deepEqual(sources.map(x=>x.source??'subscription').sort(),['free','paid','subscription']);
   assert.deepEqual({...daily(f)},{used:499,reserved:1});
   assert.deepEqual({...f.sql.prepare("SELECT free_generation_reserved,paid_generation_reserved FROM credit_accounts").get()},{free_generation_reserved:1,paid_generation_reserved:1});
   const sequence=[...sources].sort((x,y)=>({paid:0,free:1,subscription:2}[x.source??'subscription'])-({paid:0,free:1,subscription:2}[y.source??'subscription']));
   for(const {n} of sequence){
     await finishGeneration(f.env,'test-user',id(n),'ready',{model:'mock',inputTokens:1,outputTokens:1,costMicroUsd:10});
     assert.equal((await ack(f,n)).status,200);
     assert.equal((await ack(f,n)).body.alreadyConfirmed,true);
   }
   assert.deepEqual({...daily(f)},{used:500,reserved:0});
   assert.deepEqual({...f.sql.prepare("SELECT free_balance,paid_balance,free_generation_reserved,paid_generation_reserved FROM credit_accounts").get()},{free_balance:0,paid_balance:0,free_generation_reserved:0,paid_generation_reserved:0});
   await assert.rejects(reserve(f,944),error=>error.code==='INSUFFICIENT_CREDITS');
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM subscription_usage_events WHERE event_type='consume'").get().n,1);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='generation_debit'").get().n,2);
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
