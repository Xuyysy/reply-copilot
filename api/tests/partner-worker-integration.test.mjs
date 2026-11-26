import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash,createHmac} from 'node:crypto';
import {fixture,worker} from './helpers/payment-v2.mjs';
const root='/v1/admin/partners/';
const me='/v1/partners/';
const secret='local-v2-auth-secret-which-is-not-a-real-secret';
const reason='local synthetic review only';
function setup(t){
 const f=fixture();t.after(()=>f.sql.close());
 for(const name of ['0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1b_recovery_proposal.sql','partners_v1d_payout_proposal.sql','partners_alipay_recipient_proposal.sql','partners_alipay_transfer_proposal.sql','partners_query_indexes_proposal.sql'])f.sql.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 const db=f.sql,now=Date.now();
 // No real network or payment operations. Every account, session and
 // provider fact below is synthetic and confined to this memory database.
 const oldFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('EXTERNAL_NETWORK_FORBIDDEN');};t.after(()=>{globalThis.fetch=oldFetch;});
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',PARTNER_ACCRUAL_REVIEW_ENABLED:'1',PARTNER_SCHEDULED_ACCRUAL_ENABLED:'1',PARTNER_DISCOVERY_ENABLED:'1',PARTNER_SCHEDULED_DISCOVERY_ENABLED:'1',PARTNER_PAYOUT_REVIEW_ENABLED:'1',PARTNER_ALIPAY_KEY_ID:'fixture',PARTNER_ALIPAY_ENCRYPTION_KEY:'42'.repeat(32)});
 const tokens={};
 for(const [id,role,token] of [['a','admin','a'.repeat(64)],['p','user','c'.repeat(64)],['b','user','d'.repeat(64)],['q','user','e'.repeat(64)]]){
  tokens[id]=token;
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
  db.prepare("INSERT INTO sessions(id,token_hash,user_id,kind,created_at,expires_at) VALUES(?,?,?,'web',1,?)").run('session-'+id,createHash('sha256').update(token).digest('hex'),id,now+3600000);
  db.prepare("INSERT INTO credit_accounts(user_id,free_balance,paid_balance,created_at,updated_at) VALUES(?,0,0,1,1)").run(id);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'a',1)");
 function reauth(){db.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('session-a',?) ON CONFLICT(session_id) DO UPDATE SET expires_at=excluded.expires_at").run(Date.now()+3600000);}
 async function call(id,path,body,extra={}){
  const token=tokens[id];
  const headers={Origin:f.env.WEB_ORIGIN,Cookie:'rc_session='+token,'Content-Type':'application/json','X-Reply-Copilot-Action':'1','X-CSRF-Token':createHmac('sha256',secret).update('csrf:'+token).digest('hex'),...extra};
  const res=await worker.fetch(new Request(f.env.API_ORIGIN+path,{method:body===undefined?'GET':'POST',headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),f.env);
  return {status:res.status,body:await res.json(),cache:res.headers.get('Cache-Control')};
 }
 function enable(){db.exec("UPDATE system_settings SET value='1' WHERE key LIKE 'partner_%_enabled'");}
 const policy={userId:'p',operationId:randomUUID(),status:'active',level:'standard',rateBps:2000,termMonths:12,expectedVersion:0,reason};
 async function ok(...args){const r=await call(...args);assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
 return {f,db,call,ok,reauth,enable,policy};
}
test('actual Worker routes enforce disabled gates, ownership, CSRF, reauthentication and masked recipient reads',async t=>{
 const {db,call,ok,reauth,enable,policy}=setup(t);
 assert.deepEqual(await ok('p',me+'me'),{enabled:false});
 assert.equal((await call('q',root+'policy?q=p')).status,403);
 enable();
 assert.equal((await call('a',root+'policy',policy)).status,403);
 reauth();
 assert.equal((await call('a',root+'policy',policy,{'X-CSRF-Token':'bad'})).status,403);
 assert.equal((await call('q',root+'policy',policy)).status,403);
 assert.equal((await ok('a',root+'policy',policy)).version,1);
 assert.equal((await call('a',root+'policy',policy)).status,409);
 const recipient={expectedVersion:0,account:'fixture@example.test',name:'测试账户'};
 assert.equal((await call('q',me+'alipay-recipient',recipient)).status,403);
 const saved=await ok('p',me+'alipay-recipient',recipient);
 assert.equal(saved.recipient.version,1);
 assert.equal(saved.recipient.account_mask,'f***@***');
 assert.doesNotMatch(JSON.stringify(saved),/fixture@example\.test|测试账户/);
 const loaded=await call('p',me+'alipay-recipient');
 assert.equal(loaded.cache,'no-store');
 assert.doesNotMatch(JSON.stringify(loaded.body),/fixture@example\.test|测试账户|ciphertext_hex/);
 assert.equal((await call('p',me+'alipay-recipient',recipient)).status,409);
 assert.equal((await call('p',me+'alipay-requests',{amountFen:999,recipientVersion:1})).status,400);
 assert.equal((await call('p',me+'alipay-requests',{amountFen:1000,recipientVersion:1})).status,409);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_alipay_requests').get().n,0);
});
for(const mode of ['manual','scheduled']){
test(`actual Worker ${mode} discovery, accrual, payout and refund use real migration tables`,async t=>{
 const {f,db,call,ok,reauth,enable,policy}=setup(t);enable();reauth();
 await ok('a',root+'policy',policy);
 await ok('p',me+'alipay-recipient',{expectedVersion:0,account:'fixture@example.test',name:'测试账户'});
 const effective=db.prepare("SELECT effective_at FROM partner_policy_versions WHERE user_id='p'").get().effective_at;
 // The synthetic payment is at the first authorized instant; no mutation
 // of immutable policy rows. The one-millisecond hold is fixture-only.
 const paid=effective,applied=paid;
 db.prepare("INSERT INTO referral_invites(invited_user_id,inviter_user_id,referral_code,registered_at) VALUES('b','p','0123456789abcdef',?)").run(paid);
 db.prepare("INSERT INTO partner_accrual_windows VALUES('w',?,NULL,'product_principal',1,'a','fixture only')").run(paid);
 db.prepare("INSERT INTO recharge_orders(id,user_id,package_id,package_name,credits,amount_cents,currency,status,payment_method,provider_reference,created_at,paid_at,credited_at) VALUES('o','b','starter','fixture',500,100,'USD','paid','mk99','out',?,?,?)").run(paid,paid,applied);
 db.prepare("INSERT INTO payment_transactions(id,order_id,provider,currency,amount_fen,base_amount_fen,service_fee_fen,fee_rate_bps,fee_snapshot_version,provider_fee_projection_status,status,provider_trade_id,created_at,updated_at,payment_protocol,payment_channel,settlement_mode,exchange_rate_micros,merchant_provider,merchant_account,notification_sign_type,amount_contract,provider_requested_fen,provider_payment_id,paid_at) VALUES('tx','o','xiaodou','CNY',10000,10000,0,0,'fee-v1','not_applicable','paid','out',?,?,'rsa2','ALIPAY_H5','fixed_cny',1000000,'mk99','fixture','MD5','CNY_EXACT_BUYER_TOTAL',10000,'trade',?)").run(paid,paid,paid);
 db.prepare("INSERT INTO provider_payment_events(id,provider,provider_event_id,transaction_id,event_type,amount_fen,currency,body_sha256,received_at,merchant_provider) VALUES('ev','xiaodou','mk99:paid:trade','tx','PAYMENT_SUCCEEDED',10000,'CNY',?,?,'mk99')").run('a'.repeat(64),paid);
 db.prepare("INSERT INTO credit_ledger(id,user_id,kind,free_delta,paid_delta,reference_id,reason,created_at) VALUES('l','b','purchase_grant',0,500,'o','fixture',?)").run(applied);
 db.prepare("INSERT INTO credit_batches(id,user_id,bucket,source_kind,source_order_id,grant_credits,remaining_credits,granted_at,paid_at,history_confidence,status) VALUES('cb','b','paid','purchase','o',500,500,?,?,'tracked','active')").run(applied,paid);
 db.exec("UPDATE credit_accounts SET paid_balance=500 WHERE user_id='b'");
 const command={domain:'recharge',orderId:'o',operationId:randomUUID(),reason,riskReviewed:true};
 db.exec("INSERT INTO partner_discovery_cursors VALUES('recharge',0,'',0),('subscription',0,'',0)");
 if(mode==='scheduled')await worker.scheduled({},f.env);
 else{
  const state=await ok('p',me+'me');
  assert.equal(state.policy.version,1);assert.equal(state.policy.rate_bps,2000);assert.equal(state.totals.orders,0);
  const requests=await ok('p',me+'alipay-requests');
  assert.equal(requests.accepting,true);assert.equal(requests.minFen,1000);
  const found=await ok('a',root+'discovery',{action:'discover',domain:'recharge'});
  assert.deepEqual([found.scanned,found.enqueued],[1,1]);
 }
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs WHERE order_id='o'").get().state,'pending');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,0);
 assert.equal(db.prepare("SELECT order_id FROM partner_discovery_cursors WHERE order_domain='recharge'").get().order_id,'o');
 const preview=await ok('a',root+'accrual-review?action=inspect&domain=recharge&orderId=o');
 assert.equal(preview.ok,true);
 assert.deepEqual([preview.principalFen,preview.refundedFen,preview.rateBps,preview.policyVersion,preview.candidateFen],[10000,0,2000,1,2000]);
 const accrual={...command,action:mode==='scheduled'?'approve_for_queue':'record'};
 assert.equal((await call('a',root+'accrual-review',{...accrual,expectedSnapshot:'0'.repeat(64)})).status,409);
 await ok('a',root+'accrual-review',{...accrual,expectedSnapshot:preview.snapshot});
 if(mode==='scheduled')await worker.scheduled({},f.env);
 // Ensure the fixture-only one-millisecond hold has elapsed.
 if(Date.now()<=applied+1)await new Promise(resolve=>setTimeout(resolve,2));
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs WHERE order_id='o'").get().state,'done');
 assert.equal(db.prepare("SELECT commission_fen FROM partner_commissions WHERE order_id='o'").get().commission_fen,2000);
 const r=await ok('p',me+'alipay-requests',{amountFen:1000,recipientVersion:1});
 assert.equal((await call('p',me+'alipay-requests',{amountFen:1000,recipientVersion:1})).status,409);
 const action={requestId:r.requestId,reason,reviewed:true};
 assert.equal((await call('q',root+'payout-review',{...action,operationId:randomUUID(),action:'approve'})).status,403);
 await ok('a',root+'payout-review',{...action,operationId:randomUUID(),action:'approve'});
 db.exec("UPDATE payment_transactions SET risk_state='manual_review' WHERE id='tx'");
 assert.equal((await call('a',root+'payout-review',{...action,operationId:randomUUID(),action:'start'})).status,409);
 db.exec("UPDATE payment_transactions SET risk_state='clear' WHERE id='tx'");
 const started=await call('a',root+'payout-review',{...action,operationId:randomUUID(),action:'start'});
 assert.equal(started.status,200,JSON.stringify(started.body));assert.equal(started.cache,'no-store');
 assert.equal(started.body.recipient.account,'fixture@example.test');
 assert.equal((await call('a',root+'payout-review',{...action,operationId:randomUUID(),action:'start'})).status,409);
 f.env.PARTNER_PAYOUT_REVIEW_ENABLED='0';
 db.exec("UPDATE system_settings SET value='0' WHERE key LIKE 'partner_%_enabled'");
 await ok('a',root+'payout-review',{...action,operationId:randomUUID(),action:'paid',amountFen:1000,reference:'synthetic-transfer'});
 assert.equal(db.prepare("SELECT status FROM partner_payouts").get().status,'paid');
 assert.equal((await call('a',root+'payout-review',{...action,operationId:randomUUID(),action:'paid',amountFen:1000,reference:'synthetic-transfer'})).status,409);
 // Simulate an already-confirmed full refund in the source payment ledger.
 // This is NOT a provider callback or a test of the buyer credit reversal.
 const refundAt=Date.now();
 db.prepare("INSERT INTO payment_refunds(id,transaction_id,out_refund_no,amount_fen,status,reason,credits_reserved,base_amount_fen,service_fee_amount_fen,refund_kind,credits_to_revoke,actor_user_id,reviewer_user_id,reason_category,credit_adjustment_confirmed,credit_batch_id,created_at,updated_at,succeeded_at,resolved_event_id) VALUES('refund','tx','refund-fixture',10000,'succeeded','synthetic confirmed refund',0,10000,0,'special',0,'a','a','merchant_or_legal',1,NULL,?,?,?,'synthetic-refund-event')").run(refundAt,refundAt,refundAt);
 db.exec("UPDATE payment_transactions SET status='refunded',principal_refunded_fen=10000 WHERE id='tx'; UPDATE recharge_orders SET status='refunded' WHERE id='o'");
 f.env.PARTNER_SCHEDULED_REFUND_SYNC_ENABLED='1';
 db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_refund_sync_enabled','partner_scheduled_refund_sync_enabled')");
 if(mode==='scheduled')await worker.scheduled({},f.env);
 else{
  const refund={action:'refund_sync',domain:'recharge',orderId:'o'};
  assert.equal((await ok('a',root+'discovery',refund)).state,'recorded');
  assert.equal((await ok('a',root+'discovery',refund)).state,'unchanged');
 }
 assert.equal(db.prepare("SELECT SUM(delta_fen) total FROM partner_commission_refunds").get().total,-2000);
 assert.equal(db.prepare("SELECT status FROM partner_payouts").get().status,'paid');
 if(mode==='scheduled'){await worker.scheduled({},f.env);await worker.scheduled({},f.env);}
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commission_refunds").get().n,1);
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_program_enabled'");
 const summary=await ok('p',me+'me');
 const {gross_fen,net_fen,paid_fen,reserved_fen,outstanding_fen}=summary.totals;
 assert.deepEqual([gross_fen,net_fen,paid_fen,reserved_fen,outstanding_fen],[2000,0,1000,0,-1000]);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

}

test('staging test-account marker and production pilot isolation remain enforced',async t=>{
 const {f,db,call,ok,reauth,enable,policy}=setup(t);enable();reauth();
 // A real test-account marker must never be weakened merely to demonstrate
 // the cash flow. Eligible synthetic users are permitted only in this
 // isolated memory database, with no provider/network access.
 db.exec("UPDATE users SET is_test_account=1 WHERE id='p'");
 assert.equal((await call('a',root+'policy',policy)).status,409);
 assert.equal((await ok('p',me+'me')).policy,null);
 assert.equal((await call('p',me+'alipay-recipient',{expectedVersion:0,account:'fixture@example.test',name:'测试账户'})).status,403);
 assert.equal((await call('p',me+'alipay-requests',{amountFen:1000,recipientVersion:1})).status,403);
 // Actual schema enforces a singleton admin at the database level.
 assert.throws(()=>db.exec("UPDATE users SET role='admin' WHERE id='q'"),/UNIQUE constraint failed/);
 assert.equal((await call('q',root+'policy?q=p')).status,403);
 // Even with every pilot binding/DB switch enabled, the actual Worker
 // must not execute production pilot review or discovery.
 f.env.ENVIRONMENT='production';
 assert.equal((await call('a',root+'accrual-review?state=pending')).status,404);
 assert.equal((await call('a',root+'discovery',{action:'discover',domain:'recharge'})).status,404);
 assert.equal((await call('a',root+'payout-review',{action:'approve',requestId:'fixture',operationId:randomUUID(),reason,reviewed:true})).status,404);
 await worker.scheduled({},f.env);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_accrual_jobs").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payouts").get().n,0);
});
