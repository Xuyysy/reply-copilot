import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {payoutReviewRowsPlan,allocateReviewedItems,payoutEvidenceMatches,payoutReviewAssertions} from '../src/partner-payout-review.mjs';
import {paymentEvidencePlan} from '../src/partner-payment-proof.mjs';
import {alipayAdmissionPlan,alipayRequestPlan,alipayApprovePlan,alipayRejectPlan,alipayStartPlan,alipayOutcomePlan} from '../src/partner-transfer.mjs';
import {refundInsertPlan} from '../src/partner-ledger.mjs';
import {partnerSummaryPlan,payoutResolvePlan} from '../src/partner-payout.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE site_administrator(id INTEGER PRIMARY KEY,user_id TEXT REFERENCES users(id));
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 INSERT INTO users VALUES('a','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('q','user','active',1,NULL,0),('b','user','active',1,NULL,0);
 INSERT INTO site_administrator VALUES(1,'a');`);
 for(const name of ['partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1b_recovery_proposal.sql','partners_v1d_payout_proposal.sql','partners_alipay_recipient_proposal.sql','partners_alipay_transfer_proposal.sql'])
 db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 db.exec(`INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,1,'a','test only');
 INSERT INTO partner_commissions VALUES('recharge','o','p','b',1,10,11,'product_principal','CNY',1000,2000,200,20,11);
 INSERT INTO partner_alipay_recipients VALUES('p',1,'fixture','000000000000000000000000','00000000000000000000000000000000','d***@***','测**',12);`);
 return db;
}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_alipay_recipient_enabled','partner_payout_enabled')");}
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
function batch(db,ps){db.exec('BEGIN');try{for(const p of ps)assert.equal(run(db,p),1);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const request={requestId:'r',partnerId:'p',recipientVersion:1,amountFen:200,now:25};
const approve={...request,payoutId:'x',actorId:'a',now:30,reason:'verified fixture',items:[{orderDomain:'recharge',orderId:'o',amountFen:200}]};
const start={payoutId:'x',actorId:'a',now:40,reason:'verified fixture'};
const outcome={...start,now:50,outcome:'paid',amountFen:200,reference:'fixture-transfer'};
function ready(db){enable(db);assert.equal(run(db,alipayRequestPlan(request)),1);batch(db,alipayApprovePlan(approve));}
function state(db){return db.prepare("SELECT status FROM partner_payouts WHERE id='x'").get()?.status;}
test('application is default off and approval binds exact request amount and recipient version atomically',t=>{
 const db=fixture(t);assert.equal(run(db,alipayRequestPlan(request)),0);enable(db);
 assert.equal(run(db,alipayRequestPlan({...request,partnerId:'q'})),0);
 assert.equal(run(db,alipayRequestPlan(request)),1);
 assert.equal(run(db,alipayRequestPlan({...request,requestId:'r2'})),0);
 for(const patch of [{requestId:'missing'},{actorId:'q'},{items:[{...approve.items[0],amountFen:100}]}])
  assert.throws(()=>batch(db,alipayApprovePlan({...approve,...patch})));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_payouts').get().n,0);
 batch(db,alipayApprovePlan(approve));assert.equal(state(db),'reserved');
 assert.equal(db.prepare("SELECT recipient_version FROM partner_alipay_payout_destinations WHERE payout_id='x'").get().recipient_version,1);
 assert.equal(db.prepare("SELECT status FROM partner_alipay_requests WHERE id='r'").get().status,'approved');
 assert.equal(run(db,alipayRequestPlan({...request,requestId:'r2'})),0);
});
test('refund before transfer prevents start; unknown transfer stays locked',t=>{
 const db=fixture(t);ready(db);
 assert.equal(run(db,alipayStartPlan({...start,actorId:'q'})),0);
 assert.throws(()=>run(db,payoutResolvePlan({payoutId:'x',actorId:'a',now:35,status:'paid',transferReference:'bypass'})),/evidence/);
 assert.equal(run(db,alipayStartPlan(start)),1);
 assert.equal(run(db,alipayStartPlan({...start,now:41})),0);
 assert.throws(()=>run(db,payoutResolvePlan({payoutId:'x',actorId:'a',now:45,status:'cancelled'})),/unknown transfer/);
 assert.throws(()=>run(db,alipayOutcomePlan({...outcome,amountFen:199})),/invalid transfer outcome/);
 assert.equal(state(db),'reserved');
 assert.equal(run(db,alipayOutcomePlan({...outcome,outcome:'no_transfer',amountFen:0,reference:null})),1);
 assert.equal(state(db),'cancelled');
});
test('refund before manual transfer requires reconciliation',t=>{
 const db=fixture(t);ready(db);
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'rr',cumulativePrincipalFen:500,now:35})),1);
 assert.throws(()=>run(db,alipayStartPlan(start)),/reconciliation/);
 assert.equal(state(db),'reserved');
});
test('actual successful transfer is recorded despite later refund or disabled gate',t=>{
 const db=fixture(t);ready(db);assert.equal(run(db,alipayStartPlan(start)),1);
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'rr',cumulativePrincipalFen:1000,now:45})),1);
 db.exec("UPDATE system_settings SET value='0'");
 assert.equal(run(db,alipayOutcomePlan(outcome)),1);
 assert.equal(state(db),'paid');
 assert.equal(run(db,alipayOutcomePlan(outcome)),0);
 const plan=partnerSummaryPlan('p',60),s=db.prepare(plan.sql).get(...plan.params);
 assert.equal(s.paid_fen,200);assert.equal(s.outstanding_fen,-200);
 assert.throws(()=>db.exec("DELETE FROM partner_alipay_transfer_outcomes"),/immutable/);
});
test('owner can reject only a pending application',t=>{
 const db=fixture(t);enable(db);assert.equal(run(db,alipayRequestPlan(request)),1);
 const reject={requestId:'r',actorId:'a',now:30,reason:'fixture rejected'};
 assert.equal(run(db,alipayRejectPlan({...reject,actorId:'q'})),0);
 assert.equal(run(db,alipayRejectPlan(reject)),1);
 assert.equal(run(db,alipayRejectPlan(reject)),0);
 assert.throws(()=>batch(db,alipayApprovePlan(approve)));
});

test('public admission requires explicit minimum and enabled request gate, mature balance and current recipient',t=>{
 const db=fixture(t);enable(db);
 assert.equal(db.prepare("SELECT value FROM system_settings WHERE key='partner_payout_min_fen'").get().value,'1000');
 db.exec("INSERT INTO partner_commissions VALUES('recharge','o2','p','b',1,10,11,'product_principal','CNY',4000,2000,800,20,11)");
 const candidate={...request,minFen:1000,amountFen:1000};
 assert.equal(run(db,alipayAdmissionPlan(candidate)),0);
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_payout_requests_enabled'");
 assert.throws(()=>alipayAdmissionPlan({...candidate,amountFen:999}),/INVALID/);
 assert.throws(()=>alipayAdmissionPlan({...candidate,minFen:999}),/INVALID/);
 assert.equal(run(db,alipayAdmissionPlan({...candidate,minFen:1001,amountFen:1001})),0);
 assert.equal(run(db,alipayAdmissionPlan({...candidate,amountFen:1001})),0);
 assert.equal(run(db,alipayAdmissionPlan({...candidate,now:19})),0);
 assert.equal(run(db,alipayAdmissionPlan({...candidate,recipientVersion:2})),0);
 assert.equal(run(db,alipayAdmissionPlan({...candidate,partnerId:'q'})),0);
 assert.equal(run(db,alipayAdmissionPlan(candidate)),1);
 assert.equal(run(db,alipayAdmissionPlan({...candidate,requestId:'r2'})),0);
});
test('request routes use session-owned reads, CSRF and reauthenticated admin writes',()=>{
 const source=readFileSync(new URL('../src/partner-requests.ts',import.meta.url),'utf8');
 assert.match(source,/if\(write\)await requireCsrf\(request,env,token\)/);
 assert.match(source,/partnerId:session\.user_id/);
 assert.match(source,/WHERE q\.partner_user_id=\? ORDER BY q\.created_at DESC,q\.id DESC LIMIT 30"\)\.bind\(session\.user_id\)/);
 assert.match(source,/requireAdminSession\(request,env,write\)/);
 assert.doesNotMatch(source,/openAlipayRecipient|alipayStartPlan|alipayOutcomePlan/);
});

function payoutReviewFixture(t){
 const db=fixture(t);enable(db);
 db.exec(`UPDATE system_settings SET value='1' WHERE key='partner_payout_review_enabled';
 CREATE TABLE recharge_orders(id TEXT,user_id TEXT,status TEXT,paid_at INTEGER,credited_at INTEGER,credits INTEGER);
 CREATE TABLE payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,status TEXT,risk_state TEXT,currency TEXT,amount_fen INTEGER,base_amount_fen INTEGER,service_fee_fen INTEGER,principal_refunded_fen INTEGER,provider_trade_id TEXT,provider_payment_id TEXT,paid_at INTEGER);
 CREATE TABLE subscription_payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,provider_trade_id TEXT,provider_payment_id TEXT,paid_at INTEGER,status TEXT,risk_state TEXT,currency TEXT,amount_fen INTEGER);
 CREATE TABLE subscription_orders(id TEXT,user_id TEXT,kind TEXT,status TEXT,paid_at INTEGER,applied_at INTEGER,amount_fen INTEGER,target_period_id TEXT);
 CREATE TABLE subscription_payment_events(transaction_id TEXT,merchant_provider TEXT,event_type TEXT,amount_fen INTEGER,body_sha256 TEXT,provider_event_id TEXT);
 CREATE TABLE subscription_periods(id TEXT,source_order_id TEXT,user_id TEXT);
 CREATE TABLE subscription_tier_changes(order_id TEXT,period_id TEXT,charged_fen INTEGER);
 CREATE TABLE provider_payment_events(transaction_id TEXT,merchant_provider TEXT,event_type TEXT,amount_fen INTEGER,currency TEXT);
 CREATE TABLE credit_ledger(kind TEXT,reference_id TEXT,user_id TEXT,paid_delta INTEGER);
 CREATE TABLE credit_batches(source_order_id TEXT,user_id TEXT,source_kind TEXT,grant_credits INTEGER);
 CREATE TABLE payment_refunds(transaction_id TEXT,status TEXT,base_amount_fen INTEGER);
 INSERT INTO recharge_orders VALUES('o','b','paid',10,11,500);
 INSERT INTO payment_transactions VALUES('tx','o','xiaodou','paid','clear','CNY',1000,1000,0,0,'out-r','pay-r',10);
 INSERT INTO provider_payment_events VALUES('tx','xiaodou','PAYMENT_SUCCEEDED',1000,'CNY');
 INSERT INTO credit_ledger VALUES('purchase_grant','o','b',500);
 INSERT INTO credit_batches VALUES('o','b','purchase',500);`);
 return db;
}
function reviewSnapshot(db){
 const p=payoutReviewRowsPlan('p'),rows=db.prepare(p.sql).all(...p.params);
 const reviewed=rows.map(commission=>{
  const q=paymentEvidencePlan(commission.order_domain,commission.order_id);
  const evidence=db.prepare(q.sql).all(...q.params);
  assert.equal(payoutEvidenceMatches(commission,evidence),true);
  return {commission,evidence:evidence[0]};
 });
 return {rows,reviewed};
}
function atomic(db,ps){db.exec('BEGIN');try{for(const p of ps)run(db,p);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
test('payout review allocates mature funds and checks current evidence in same transaction',t=>{
 const db=payoutReviewFixture(t);
 assert.equal(run(db,alipayRequestPlan(request)),1);
 const {rows,reviewed}=reviewSnapshot(db);
 assert.equal(allocateReviewedItems(rows,200,19),null);
 assert.equal(allocateReviewedItems(rows,201,30),null);
 const items=allocateReviewedItems(rows,200,30);
 assert.deepEqual(items,approve.items);
 const g=payoutReviewAssertions({partnerId:'p',rows:reviewed,operationId:'op'});
 const work=[...g.checks,...alipayApprovePlan({...approve,items}),g.cleanup];
 db.exec("UPDATE payment_transactions SET risk_state='manual_review'");
 assert.throws(()=>atomic(db,work));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payouts").get().n,0);
 db.exec("UPDATE payment_transactions SET risk_state='clear'");
 atomic(db,work);
 assert.equal(state(db),'reserved');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
});
test('unposted refund stops payout review even before ledger refund synchronization',t=>{
 const db=payoutReviewFixture(t);
 const {rows,reviewed}=reviewSnapshot(db);
 db.exec("UPDATE payment_transactions SET principal_refunded_fen=100; INSERT INTO payment_refunds VALUES('tx','succeeded',100)");
 const q=paymentEvidencePlan('recharge','o');
 assert.equal(payoutEvidenceMatches(rows[0],db.prepare(q.sql).all(...q.params)),false);
 const g=payoutReviewAssertions({partnerId:'p',rows:reviewed,operationId:'op'});
 assert.throws(()=>atomic(db,[...g.checks,g.cleanup]));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
});
test('payout review endpoint is non-production and reauthenticated; recipient revealed only after batch',()=>{
 const s=readFileSync(new URL('../src/partner-payout-review.ts',import.meta.url),'utf8');
 assert.match(s,/requireAdminSession\(request,env,true\)/);
 assert.match(s,/PARTNER_PAYOUT_REVIEW_ENABLED==='1'/);
 assert.match(s,/\['development','staging'\]\.includes\(env\.ENVIRONMENT\)/);
 assert.match(s,/openAlipayRecipient/);
 assert.ok(s.lastIndexOf('await env.DB.batch')<s.lastIndexOf('...(recipient?'));
});

test('fully reversed recharge is evidence for debt review, not new accrual or available funds',t=>{
 const db=payoutReviewFixture(t);
 db.exec("UPDATE payment_transactions SET principal_refunded_fen=1000,status='refunded'; UPDATE recharge_orders SET status='refunded'; INSERT INTO payment_refunds VALUES('tx','succeeded',1000)");
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'full',cumulativePrincipalFen:1000,now:25})),1);
 const {rows,reviewed}=reviewSnapshot(db);
 assert.equal(rows[0].remaining_fen,0);assert.equal(allocateReviewedItems(rows,1,30),null);
 const g=payoutReviewAssertions({partnerId:'p',rows:reviewed,operationId:'opfull'});
 atomic(db,[...g.checks,g.cleanup]);
 db.exec("UPDATE payment_transactions SET risk_state='manual_review'");
 assert.throws(()=>atomic(db,[...g.checks,g.cleanup]));
});

function largeHistory(t,n=45){
 const db=payoutReviewFixture(t);
 db.exec("INSERT INTO partner_payment_identity_claims VALUES('xiaodou','out-r','pay-r','recharge','o',11)");
 for(let i=1;i<n;i++){
  const o='o'+String(i).padStart(3,'0'),tx='tx'+i,out='out'+i,pay='pay'+i;
  db.prepare("INSERT INTO partner_commissions VALUES('recharge',?,'p','b',1,10,11,'product_principal','CNY',1000,2000,200,20,11)").run(o);
  db.prepare("INSERT INTO recharge_orders VALUES(?,'b','paid',10,11,500)").run(o);
  db.prepare("INSERT INTO payment_transactions VALUES(?,?,'xiaodou','paid','clear','CNY',1000,1000,0,0,?,?,10)").run(tx,o,out,pay);
  db.prepare("INSERT INTO provider_payment_events VALUES(?,'xiaodou','PAYMENT_SUCCEEDED',1000,'CNY')").run(tx);
  db.prepare("INSERT INTO credit_ledger VALUES('purchase_grant',?,'b',500)").run(o);
  db.prepare("INSERT INTO credit_batches VALUES(?,'b','purchase',500)").run(o);
  db.prepare("INSERT INTO partner_payment_identity_claims VALUES('xiaodou',?,?,'recharge',?,11)").run(out,pay,o);
 }
 return db;
}
test('set-based payout checks 45 historical commissions and reserves more than 30 items atomically',async t=>{
 const {allHistoryPayoutGuard,setPayoutApprovePlan}=await import('../src/partner-payout-set-review.mjs');
 const db=largeHistory(t);
 const req={...request,amountFen:8100};
 assert.equal(run(db,alipayRequestPlan(req)),1);
 const g=allHistoryPayoutGuard({partnerId:'p',operationId:'large'});
 assert.equal(g.checks.length,3);
 assert.equal(new Set(g.checks.map(p=>p.params[0])).size,3);
 const work=[...g.checks,...setPayoutApprovePlan({...req,payoutId:'x',actorId:'a',now:30,reason:'verified fixture'}),g.cleanup];
 // A late, unallocated order must still block approval.
 db.exec("UPDATE payment_transactions SET risk_state='manual_review' WHERE order_id='o044'");
 assert.throws(()=>atomic(db,work));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payouts").get().n,0);
 db.exec("UPDATE payment_transactions SET risk_state='clear'");
 atomic(db,work);
 const items=db.prepare("SELECT COUNT(*) n,SUM(amount_fen) total FROM partner_payout_items WHERE payout_id='x'").get();
 assert.equal(items.n,41);assert.equal(items.total,8100);
 assert.equal(state(db),'reserved');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
 db.exec("UPDATE payment_transactions SET provider_payment_id='changed' WHERE order_id='o044'");
 assert.throws(()=>atomic(db,[...g.checks,alipayStartPlan(start),g.cleanup]));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_alipay_transfer_starts").get().n,0);
 db.exec("UPDATE payment_transactions SET provider_payment_id='pay44' WHERE order_id='o044'");
 atomic(db,[...g.checks,alipayStartPlan(start),g.cleanup]);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_alipay_transfer_starts").get().n,1);
});
test('set-based payout respects prior refund debt outside selected allocation',async t=>{
 const {allHistoryPayoutGuard,setPayoutApprovePlan}=await import('../src/partner-payout-set-review.mjs');
 const db=largeHistory(t,45);ready(db);run(db,alipayStartPlan(start));run(db,alipayOutcomePlan(outcome));
 db.exec("UPDATE payment_transactions SET principal_refunded_fen=1000,status='refunded' WHERE order_id='o'; UPDATE recharge_orders SET status='refunded' WHERE id='o'; INSERT INTO payment_refunds VALUES('tx','succeeded',1000)");
 assert.equal(run(db,refundInsertPlan({orderDomain:'recharge',orderId:'o',refundEventId:'full',cumulativePrincipalFen:1000,now:55})),1);
 const req={...request,requestId:'r2',amountFen:8700,now:60};
 assert.equal(run(db,alipayRequestPlan(req)),1);
 const g=allHistoryPayoutGuard({partnerId:'p',operationId:'debt'});
 assert.throws(()=>atomic(db,[...g.checks,...setPayoutApprovePlan({...req,payoutId:'x2',actorId:'a',now:61,reason:'verified fixture'}),g.cleanup]),/insufficient partner net balance/);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_payouts").get().n,1);
});

test('set review accepts exact fully reversed subscription proof and rejects changed evidence',async t=>{
 const {allHistoryPayoutGuard}=await import('../src/partner-payout-set-review.mjs');
 const {subscriptionRefundCandidatePlan,subscriptionRefundSyncPlan}=await import('../src/partner-subscription-refund.mjs');
 const {createHash}=await import('node:crypto');
 const db=largeHistory(t,2);
 db.exec(`INSERT INTO partner_commissions VALUES('subscription','s','p','b',1,10,11,'product_principal','CNY',1000,2000,200,20,11);
 INSERT INTO subscription_orders VALUES('s','b','purchase','refunded',10,11,1000,NULL);
 INSERT INTO subscription_payment_transactions VALUES('st','s','mk99','out-s','pay-s',10,'refunded','frozen','CNY',1000);
 INSERT INTO subscription_periods VALUES('period','s','b');
 INSERT INTO subscription_payment_events VALUES('st','mk99','PAYMENT_SUCCEEDED',1000,'fixture','paid-s');
 INSERT INTO partner_payment_identity_claims VALUES('mk99','out-s','pay-s','subscription','s',11);
 UPDATE system_settings SET value='1' WHERE key='partner_refund_sync_enabled';`);
 const g=allHistoryPayoutGuard({partnerId:'p',operationId:'sub'});
 assert.throws(()=>atomic(db,[...g.checks,g.cleanup]));
 const digest=createHash('sha256').update(JSON.stringify(['out-s','pay-s','TRADE_REFUND',1000])).digest('hex');
 db.prepare("INSERT INTO subscription_payment_events VALUES('st','mk99','TRADE_REFUND',1000,?,?)").run(digest,'sub-risk:'+digest);
 const q=subscriptionRefundCandidatePlan('s'),rows=db.prepare(q.sql).all(...q.params);
 const plan=await subscriptionRefundSyncPlan({orderId:'s',rows,now:25});
 assert.equal(run(db,plan.write),1);
 atomic(db,[...g.checks,g.cleanup]);
 db.exec("UPDATE subscription_payment_events SET body_sha256='changed' WHERE event_type='TRADE_REFUND'");
 assert.throws(()=>atomic(db,[...g.checks,g.cleanup]));
});

test('request state cannot be forged or reviewed with null evidence fields',t=>{
 const db=fixture(t);enable(db);
 assert.throws(()=>db.exec("INSERT INTO partner_alipay_requests(id,partner_user_id,recipient_version,amount_fen,created_at,status,reviewed_by,reviewed_at,reason) VALUES('forged','p',1,1000,25,'rejected','a',26,'fixture rejected')"));
 assert.equal(run(db,alipayRequestPlan(request)),1);
 assert.throws(()=>db.exec("UPDATE partner_alipay_requests SET status='rejected',reviewed_by='a',reviewed_at=NULL,reason='fixture rejected' WHERE id='r'"));
 assert.throws(()=>db.exec("UPDATE partner_alipay_requests SET status='rejected',reviewed_by='a',reviewed_at=26,reason=NULL WHERE id='r'"));
 assert.equal(db.prepare("SELECT status FROM partner_alipay_requests WHERE id='r'").get().status,'pending');
});
