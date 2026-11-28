import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {fixture,worker} from './helpers/payment-v2.mjs';
import {manualCandidatePlan,manualEvidenceBatchPlan} from '../src/partner-manual-calculation.mjs';

// Offline-only SQLite and bundled Worker. The ordinary paid-order fixture
// exists exclusively inside this in-memory DB; no provider requests, remote
// data, real funds, refund operations, credentials or release actions.
test('incremental commission ledger: historical backlog, bounded sync, page, atomic balance and risk invalidation',async t=>{
 const f=fixture({released:false}),db=f.sql;t.after(()=>db.close());
 for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_manual_record_proposal.sql'])db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 // Verify both read queries against the full local schema even with no orders.
 for(const domain of ['recharge','subscription']){
  for(const p of [manualCandidatePlan(domain,'partner'),manualEvidenceBatchPlan(domain,['nonexistent-order'])])
   assert.deepEqual(db.prepare(p.sql).all(...p.params),[]);
 }
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
 t.after(()=>{globalThis.fetch=originalFetch;});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PAYMENTS_ENABLED:'0',XIAODOU_WEBHOOKS_ENABLED:'0'});
 const tokens={};
 for(const [id,role] of [['owner','admin'],['partner','user'],['ordinary','user'],['other','user']]){
  const token=randomUUID().replaceAll('-','')+randomUUID().replaceAll('-','');tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('session-'+id,createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'owner',1)");
 const me='/v1/partners/manual-report',admin='/v1/admin/partners/manual-report',policy='/v1/admin/partners/policy';
 async function call(id,path,body,extra={}){
  const token=tokens[id],headers={Origin:f.env.WEB_ORIGIN,'Content-Type':'application/json','X-Reply-Copilot-Action':'1',...(token?{Cookie:'rc_session='+token,'X-CSRF-Token':createHmac('sha256',f.env.AUTH_HASH_SECRET).update('csrf:'+token).digest('hex')}:{}),...extra};
  const res=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {status:res.status,body:await res.json(),cache:res.headers.get('Cache-Control')};
 }
 async function ok(...args){const r=await call(...args);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 assert.equal((await call(null,me)).status,401);
 assert.deepEqual(await ok('partner',me),{enabled:false});
 assert.deepEqual(await ok('owner',admin),{enabled:false});
 assert.equal((await call('ordinary',admin)).status,403);
 db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_manual_reporting_enabled')");
 db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-owner',?)").run(Date.now()+3600000);
 for(const userId of ['partner','other'])await ok('owner',policy,{userId,operationId:randomUUID(),status:'active',level:'standard',rateBps:2000,termMonths:null,expectedVersion:0,reason:'offline workflow fixture'});
 assert.deepEqual(await ok('ordinary',me+'?userId=partner'),{enabled:false});
 const empty=await call('partner',me);assert.equal(empty.status,200);assert.equal(empty.cache,'no-store');
 assert.equal(empty.body.minRequestFen,1000);assert.equal(empty.body.summary.estimatedFen,0);assert.equal(empty.body.requestableFen,null);
 assert.equal((await call('partner',me,{expectedAmountFen:999})).status,409);
 assert.equal((await call('partner',me,{expectedAmountFen:1000})).status,409);
 assert.equal((await call('partner',me,{expectedAmountFen:1000},{'X-CSRF-Token':'invalid'})).status,403);
 const paid=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id='partner'").get().effective_at;
 db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES('ordinary','partner','0123456789abcdef',?)").run(paid);
 db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES('ordinary',0,0,1,1)").run();
 function paidOrder(orderId,principal){
  // Same ordinary recharge fixture contract as the repository's existing
  // offline payment regression tests. No live order or callback is created.
  const tx='tx-'+orderId,out='out-'+orderId,trade='trade-'+orderId;
  db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at,paid_at,credited_at) VALUES(?,'ordinary','starter','fixture',500,100,'USD','paid','mk99',?,?,?,?)").run(orderId,out,paid,paid,paid);
  db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,provider_payment_id,paid_at) VALUES(?,?,'xiaodou','CNY',?,?,0,0,'fee-v1','not_applicable','paid',?,?,?,'rsa2','ALIPAY_H5','fixed_cny',1000000,'mk99','fixture','MD5','CNY_EXACT_BUYER_TOTAL',?,?,?)").run(tx,orderId,principal,principal,out,paid,paid,principal,trade,paid);
  db.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) VALUES(?,'xiaodou',?,?,'PAYMENT_SUCCEEDED',?,'CNY',?,?,'mk99')").run('event-'+orderId,'fixture-paid-'+orderId,tx,principal,'a'.repeat(64),paid);
  db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES(?,'ordinary','purchase_grant',0,500,?,'offline fixture',?)").run('ledger-'+orderId,orderId,paid);
  db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,granted_at,paid_at,history_confidence,status) VALUES(?,'ordinary','paid','purchase',?,500,500,?,?,'tracked','active')").run('batch-'+orderId,orderId,paid,paid);
  db.exec("UPDATE credit_accounts SET paid_balance=paid_balance+500 WHERE user_id='ordinary'");
 }

 // Historical orders existed before the ledger schema. No payment provider
 // is called: every payment in this test is synthetic and local.
 for(let i=0;i<105;i++)paidOrder('historic-'+String(i).padStart(3,'0'),1000);
 for(const name of ['0028_boltutil_usdt.sql','0030_boltutil_five_networks_staging.sql','partner_commission_ledger_proposal.sql'])db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 f.env.BOLTUTIL_SCHEMA_READY='1';
 const flag="UPDATE system_settings SET value='1' WHERE key='partner_commission_ledger_enabled'";
 assert.throws(()=>db.exec(flag),/backfill incomplete/);
 const seed=readFileSync(new URL('../sql-proposals/partner_commission_backfill_pages.sql',import.meta.url),'utf8');
 for(const stmt of seed.split(';').map(x=>x.trim()).filter(Boolean))db.prepare(stmt).run('','zzzz');
 for(let i=0;i<20;i++)paidOrder('new-'+String(i).padStart(3,'0'),1000);
 db.exec(flag);
 const count=table=>db.prepare('SELECT COUNT(*) n FROM '+table).get().n;
 assert.equal(count('partner_commission_dirty'),125);
 const waiting=await ok('partner',me);assert.equal(waiting.syncPending,true);assert.equal(waiting.requestableFen,null);
 assert.equal(count('partner_commission_entries'),0,'GET never writes');
 assert.equal((await call('ordinary',me,{sync:true})).body.enabled,undefined);
 assert.equal((await call('partner',me,{sync:true},{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await call('partner',me,{expectedAmountFen:25000})).status,409);
 let result=await ok('partner',me,{sync:true});
 assert.equal(count('partner_commission_entries'),20);assert.equal(count('partner_commission_dirty'),105);
 assert.equal(result.syncPending,true);
 for(let i=0;i<6;i++)result=await ok('partner',me,{sync:true});
 assert.equal(result.syncPending,false);assert.equal(result.summary.verifiedOrders,125);
 assert.equal(result.summary.estimatedFen,25000);assert.equal(result.requestableFen,25000);
 assert.equal(count('partner_commission_dirty'),0);
 assert.equal(count('partner_commission_entries'),125);
 assert.equal((await ok('partner',me,{sync:true})).summary.estimatedFen,25000);
 const all=new Set();let page=result;
 for(let i=0;i<5;i++){
  for(const o of page.orders){assert.ok(!all.has(o.orderId));all.add(o.orderId);assert.equal(o.buyerId,undefined);}
  if(!page.nextCursor)break;
  page=await ok('partner',me+'?cursor='+encodeURIComponent(page.nextCursor));
  assert.equal(page.summary.estimatedFen,25000);
 }
 assert.equal(all.size,125);
 assert.equal((await call('partner',me+'?cursor=invalid')).status,400);
 // Replayed settlement doesn't enqueue unchanged state.
 db.exec("UPDATE recharge_orders SET status='paid',paid_at=paid_at,credited_at=credited_at WHERE id='new-000'");
 assert.equal(count('partner_commission_dirty'),0);
 // A change after verification invalidates the cached balance until replay.
 db.exec("UPDATE payment_transactions SET risk_state='manual_review' WHERE order_id='new-000'");
 assert.equal(count('partner_commission_dirty'),1);
 assert.equal((await ok('partner',me)).requestableFen,null);
 assert.throws(()=>db.prepare("INSERT INTO partner_manual_requests(id,partner_user_id,amount_fen,created_at) VALUES(?,?,?,?)").run(randomUUID(),'partner',25000,Date.now()),/balance changed/);
 result=await ok('partner',me,{sync:true});assert.equal(result.summary.reviewCount,1);assert.equal(result.requestableFen,24800);
 db.exec("UPDATE payment_transactions SET risk_state='clear' WHERE order_id='new-000'");
 result=await ok('partner',me,{sync:true});assert.equal(result.requestableFen,25000);assert.equal(result.summary.reviewCount,0);
 // Verify application and completed balance atomically; not a real transfer.
 await ok('partner',me,{expectedAmountFen:25000});
 const requestId=(await ok('partner',me)).pendingId;
 await ok('owner',admin,{requestId,operationId:randomUUID(),action:'completed',reason:'offline ledger synthetic settlement'});
 result=await ok('partner',me);assert.equal(result.summary.recordedFen,25000);assert.equal(result.summary.differenceFen,0);
 paidOrder('next-paid',6000);assert.equal((await ok('partner',me)).syncPending,true);
 result=await ok('partner',me,{sync:true});assert.equal(result.requestableFen,1200);
 assert.equal(count('partner_commission_entries'),126);
 // Stable report query count independent of history size. No reclassification.
 const originalPrepare=f.env.DB.prepare;let queries=[];
 f.env.DB.prepare=function(sql){queries.push(sql);return originalPrepare.call(this,sql);};
 try{assert.equal((await ok('partner',me)).requestableFen,1200);}
 finally{f.env.DB.prepare=originalPrepare;}
 assert.ok(queries.length<=14,JSON.stringify(queries));assert.ok(!queries.some(q=>/provider_payment_events|JOIN recharge_orders|JOIN subscription_orders/.test(q)));
});
