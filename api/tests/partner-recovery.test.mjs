import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {attributionPlan,reviewedFacts,reviewedAccrualBatch} from '../src/partner-accrual-review.mjs';
import {paymentEvidencePlan} from '../src/partner-payment-proof.mjs';
import {accrualEnqueuePlan,dueAccrualPlan,recoveryFailurePlan,recoveredAccrualPlan} from '../src/partner-recovery.mjs';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE users(id TEXT PRIMARY KEY,role TEXT,status TEXT,email_verified_at INTEGER,archived_at INTEGER,is_test_account INTEGER);
 CREATE TABLE system_settings(key TEXT PRIMARY KEY,value TEXT,updated_at INTEGER);
 CREATE TABLE referral_invites(invited_user_id TEXT PRIMARY KEY,inviter_user_id TEXT,registered_at INTEGER,status TEXT);
 INSERT INTO users VALUES('a','admin','active',1,NULL,0),('p','user','active',1,NULL,0),('b','user','active',1,NULL,0);
 INSERT INTO referral_invites VALUES('b','p',100,'pending');`);
 for(const name of ['partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1b_recovery_proposal.sql'])
 db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 db.exec("INSERT INTO partner_policy_versions VALUES('p',1,'active','standard',2000,12,200,'a','test only')");
 return db;
}
function enable(db){db.exec("UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled')");}
function window(db){db.exec("INSERT INTO partner_accrual_windows VALUES('w',300,NULL,'product_principal',100,'a','fixture only')");}
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
function batch(db,ps){db.exec('BEGIN');try{for(const p of ps)run(db,p);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
const order={orderDomain:'recharge',orderId:'o',paidAt:350,now:360};
const facts={...order,partnerUserId:'p',buyerUserId:'b',policyVersion:1,appliedAt:351,holdUntil:451,registeredAt:100,firstAuthorizedAt:200,termMonths:12,currency:'CNY',basis:'product_principal',principalFen:1000,rateBps:2000};
const input={facts,windowId:'w',attempts:0,refundPrincipalFen:250};
function due(db,now){const p=dueAccrualPlan(now);return db.prepare(p.sql).all(...p.params);}
test('default off, no old orders, closed interval and duplicate enqueue',t=>{
 const db=fixture(t);window(db);assert.equal(run(db,accrualEnqueuePlan(order)),0);enable(db);
 assert.equal(run(db,accrualEnqueuePlan({...order,paidAt:299})),0);
 assert.equal(run(db,accrualEnqueuePlan(order)),1);assert.equal(run(db,accrualEnqueuePlan(order)),0);
 assert.throws(()=>db.exec("INSERT INTO partner_accrual_windows VALUES('w2',301,NULL,'product_principal',100,'a','fixture only')"));
 db.exec("UPDATE partner_accrual_windows SET ends_at=400 WHERE id='w'");
 db.exec("INSERT INTO partner_accrual_windows VALUES('w2',500,NULL,'product_principal',100,'a','fixture only')");
 assert.equal(run(db,accrualEnqueuePlan({...order,orderId:'gap',paidAt:450,now:600})),0);
 assert.equal(run(db,accrualEnqueuePlan({...order,orderId:'new',paidAt:500,now:600})),1);
});
test('atomic gross, prior partial refund, done state and replay',t=>{
 const db=fixture(t);enable(db);window(db);run(db,accrualEnqueuePlan(order));
 batch(db,recoveredAccrualPlan(input));
 assert.equal(db.prepare("SELECT commission_fen FROM partner_commissions").get().commission_fen,200);
 assert.equal(db.prepare("SELECT delta_fen FROM partner_commission_refunds").get().delta_fen,-50);
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'done');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
 assert.throws(()=>batch(db,recoveredAccrualPlan(input)));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,1);
});
test('stale policy, wrong hold, disabled gate and stale attempt never partially commit',t=>{
 const db=fixture(t);enable(db);window(db);run(db,accrualEnqueuePlan(order));
 for(const patch of [{facts:{...facts,rateBps:2100}},{facts:{...facts,holdUntil:452}},{attempts:1}]){
 assert.throws(()=>batch(db,recoveredAccrualPlan({...input,...patch})));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commission_refunds").get().n,0);
 }
 db.exec("UPDATE system_settings SET value='0' WHERE key='partner_cash_accrual_enabled'");
 assert.throws(()=>batch(db,recoveredAccrualPlan(input)));
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'pending');
});
test('bounded retry, CAS and manual review',t=>{
 const db=fixture(t);enable(db);window(db);run(db,accrualEnqueuePlan(order));
 assert.equal(due(db,360).length,1);
 const failure={...order,attempts:0,code:'temporary_failure'};
 assert.equal(run(db,recoveryFailurePlan(failure)),1);
 assert.equal(run(db,recoveryFailurePlan(failure)),0);
 assert.equal(due(db,361).length,0);
 assert.equal(due(db,30360).length,1);
 assert.equal(run(db,recoveryFailurePlan({...failure,attempts:1,now:30360,code:'risk_review',review:true})),1);
 assert.equal(due(db,99999999).length,0);
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'review');
});

function reviewFixture(t){
 const db=fixture(t);enable(db);window(db);
 db.exec(`CREATE TABLE site_administrator(id INTEGER,user_id TEXT);
 INSERT INTO site_administrator VALUES(1,'a');
 UPDATE system_settings SET value='1' WHERE key='partner_accrual_review_enabled';
 CREATE TABLE recharge_orders(id TEXT,user_id TEXT,status TEXT,paid_at INTEGER,credited_at INTEGER,credits INTEGER);
 CREATE TABLE payment_transactions(id TEXT,order_id TEXT,merchant_provider TEXT,status TEXT,risk_state TEXT,currency TEXT,amount_fen INTEGER,base_amount_fen INTEGER,service_fee_fen INTEGER,principal_refunded_fen INTEGER);
 CREATE TABLE provider_payment_events(transaction_id TEXT,merchant_provider TEXT,event_type TEXT,amount_fen INTEGER,currency TEXT);
 CREATE TABLE credit_ledger(kind TEXT,reference_id TEXT,user_id TEXT,paid_delta INTEGER);
 CREATE TABLE credit_batches(source_order_id TEXT,user_id TEXT,source_kind TEXT,grant_credits INTEGER);
 CREATE TABLE payment_refunds(transaction_id TEXT,status TEXT,base_amount_fen INTEGER);
 INSERT INTO recharge_orders VALUES('o','b','paid',350,351,500);
 INSERT INTO payment_transactions VALUES('tx','o','xiaodou','paid','clear','CNY',1000,1000,0,250);
 INSERT INTO provider_payment_events VALUES('tx','xiaodou','PAYMENT_SUCCEEDED',1000,'CNY');
 INSERT INTO credit_ledger VALUES('purchase_grant','o','b',500);
 INSERT INTO credit_batches VALUES('o','b','purchase',500);
 INSERT INTO payment_refunds VALUES('tx','succeeded',250);`);
 run(db,accrualEnqueuePlan(order));
 return db;
}
function reviewBatch(db){
 const p=paymentEvidencePlan('recharge','o'),rows=db.prepare(p.sql).all(...p.params);
 const a=attributionPlan('b',350),attribution=db.prepare(a.sql).get(...a.params);
 const job=db.prepare("SELECT j.*,w.hold_ms FROM partner_accrual_jobs j JOIN partner_accrual_windows w ON w.id=j.window_id").get();
 const input=reviewedFacts({orderDomain:'recharge',orderId:'o',rows,attribution,job,now:360});
 assert.ok(input);
 return reviewedAccrualBatch({input,row:rows[0],actorId:'a',reason:'fixture reviewed',operationId:'op1'});
}
test('reviewed accrual reads actual fixture payment evidence and atomically records audit and commission',t=>{
 const db=reviewFixture(t),ps=reviewBatch(db);
 batch(db,ps);
 assert.equal(db.prepare("SELECT commission_fen FROM partner_commissions").get().commission_fen,200);
 assert.equal(db.prepare("SELECT delta_fen FROM partner_commission_refunds").get().delta_fen,-50);
 assert.equal(db.prepare("SELECT actor_id FROM partner_accrual_review_audits").get().actor_id,'a');
 assert.throws(()=>batch(db,ps));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_accrual_review_audits").get().n,1);
});
test('risk changes after review abort all accrual writes',t=>{
 const db=reviewFixture(t),ps=reviewBatch(db);
 db.exec("UPDATE payment_transactions SET risk_state='manual_review'");
 assert.throws(()=>batch(db,ps));
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_commissions").get().n,0);
 assert.equal(db.prepare("SELECT state FROM partner_accrual_jobs").get().state,'pending');
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_accrual_review_audits").get().n,0);
});
test('review endpoint prohibits production and requires reauthentication',()=>{
 const s=readFileSync(new URL('../src/partner-accrual-review.ts',import.meta.url),'utf8');
 assert.match(s,/requireAdminSession\(request,env,true\)/);
 assert.match(s,/\['development','staging'\]\.includes\(env\.ENVIRONMENT\)/);
 assert.match(s,/PARTNER_ACCRUAL_REVIEW_ENABLED!=='1'/);
 assert.match(s,/b\.riskReviewed!==true/);
});

test('discovery keyset pagination includes late entitlement application and excludes pre-window orders',async t=>{
 const {discoveryPagePlan,discoveryEnqueuePlan,cursorAdvancePlan}=await import('../src/partner-discovery.mjs');
 const db=fixture(t);enable(db);window(db);
 db.exec(`CREATE TABLE recharge_orders(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,paid_at INTEGER,credited_at INTEGER);
 INSERT INTO recharge_orders VALUES('old','b','paid',299,350),('a','b','paid',310,350),('z','b','paid',311,350),('late','b','paid',312,NULL);
 INSERT INTO partner_discovery_cursors VALUES('recharge',300,'',300);`);
 assert.equal(run(db,discoveryEnqueuePlan({domain:'recharge',orderId:'a',now:360})),0);
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_discovery_enabled'");
 const page=(afterAt,afterId)=>{const p=discoveryPagePlan({domain:'recharge',afterAt,afterId,now:400,limit:2});return db.prepare(p.sql).all(...p.params);};
 const p=page(300,'');assert.deepEqual(p.map(r=>r.order_id),['a','old']);
 assert.equal(run(db,discoveryEnqueuePlan({domain:'recharge',orderId:'a',now:360})),1);
 assert.equal(run(db,discoveryEnqueuePlan({domain:'recharge',orderId:'old',now:360})),0);
 const advance=cursorAdvancePlan({domain:'recharge',oldAt:300,oldId:'',nextAt:350,nextId:'old',now:360});
 assert.equal(run(db,advance),1);assert.equal(run(db,advance),0);
 db.exec("UPDATE recharge_orders SET credited_at=370 WHERE id='late'");
 assert.deepEqual(page(350,'old').map(r=>r.order_id),['z','late']);
 assert.equal(run(db,discoveryEnqueuePlan({domain:'recharge',orderId:'late',now:400})),1);
 assert.equal(run(db,discoveryEnqueuePlan({domain:'recharge',orderId:'late',now:400})),0);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_accrual_jobs").get().n,2);
});
test('confirmed refund sync rejects unknown or stale totals and records cumulative full reversal once',async t=>{
 const {refundCandidatePlan,confirmedRefundAmount,refundSyncPlan}=await import('../src/partner-refund-sync.mjs');
 const db=reviewFixture(t);batch(db,reviewBatch(db));
 const q=refundCandidatePlan('o'),read=()=>db.prepare(q.sql).all(...q.params);
 assert.equal(confirmedRefundAmount(read()),250);assert.equal(refundSyncPlan({orderId:'o',rows:read(),now:400}),null);
 db.exec("INSERT INTO payment_refunds VALUES('tx','unknown',750)");
 assert.equal(refundSyncPlan({orderId:'o',rows:read(),now:400}),null);
 db.exec("UPDATE payment_refunds SET status='succeeded' WHERE status='unknown'");
 assert.equal(confirmedRefundAmount(read()),null);
 db.exec("UPDATE payment_transactions SET principal_refunded_fen=1000,status='refunded'; UPDATE recharge_orders SET status='refunded'");
 const plan=refundSyncPlan({orderId:'o',rows:read(),now:400});assert.ok(plan);assert.equal(run(db,plan),0);
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_refund_sync_enabled'; UPDATE system_settings SET value='0' WHERE key='partner_cash_accrual_enabled'");
 assert.equal(run(db,plan),1);assert.equal(run(db,plan),0);
 assert.equal(db.prepare("SELECT SUM(delta_fen) total FROM partner_commission_refunds").get().total,-200);
 assert.equal(refundSyncPlan({orderId:'o',rows:read(),now:401}),null);
});

test('MK99 subscription refund requires explicit full-amount digest, not default amount or hold',async t=>{
 const {subscriptionRefundCandidatePlan,subscriptionRefundSyncPlan}=await import('../src/partner-subscription-refund.mjs');
 const {createHash}=await import('node:crypto');
 const db=fixture(t);
 db.exec(`CREATE TABLE subscription_orders(id TEXT PRIMARY KEY,user_id TEXT,kind TEXT,status TEXT,paid_at INTEGER,applied_at INTEGER,amount_fen INTEGER,target_period_id TEXT);
 CREATE TABLE subscription_payment_transactions(id TEXT PRIMARY KEY,order_id TEXT,provider_trade_id TEXT,provider_payment_id TEXT,merchant_provider TEXT,status TEXT,risk_state TEXT,currency TEXT,amount_fen INTEGER);
 CREATE TABLE subscription_payment_events(transaction_id TEXT,merchant_provider TEXT,provider_event_id TEXT,event_type TEXT,amount_fen INTEGER,body_sha256 TEXT);
 CREATE TABLE subscription_periods(id TEXT,source_order_id TEXT,user_id TEXT);
 CREATE TABLE subscription_tier_changes(order_id TEXT,period_id TEXT,charged_fen INTEGER);
 INSERT INTO partner_commissions VALUES('subscription','s','p','b',1,350,351,'product_principal','CNY',1000,2000,200,451,360);
 INSERT INTO subscription_orders VALUES('s','b','upgrade','refund_pending',350,351,1000,'period');
 INSERT INTO subscription_payment_transactions VALUES('tx','s','out','trade','mk99','paid','frozen','CNY',1000);
 INSERT INTO subscription_payment_events VALUES('tx','mk99','payment','PAYMENT_SUCCEEDED',1000,'fixture');
 INSERT INTO subscription_periods VALUES('period','old','b');
 INSERT INTO subscription_tier_changes VALUES('s','period',1000);`);
 const q=subscriptionRefundCandidatePlan('s'),read=()=>db.prepare(q.sql).all(...q.params);
 const makeDigest=amount=>createHash('sha256').update(JSON.stringify(['out','trade','TRADE_REFUND',amount])).digest('hex');
 const notice=(amount,digest)=>db.prepare("INSERT INTO subscription_payment_events VALUES('tx','mk99',?,'TRADE_REFUND',?,?)").run('sub-risk:'+digest,amount,digest);
 notice(1000,makeDigest(null)); // persisted fallback amount is NOT proof
 assert.equal(await subscriptionRefundSyncPlan({orderId:'s',rows:read(),now:500}),null);
 db.exec("UPDATE subscription_orders SET status='refunded'; UPDATE subscription_payment_transactions SET status='refunded'");
 let plan=await subscriptionRefundSyncPlan({orderId:'s',rows:read(),now:500});
 assert.ok(plan?.write);assert.equal(db.prepare(plan.proof.sql).get(...plan.proof.params),undefined);
 assert.equal(run(db,plan.write),0);
 notice(1000,makeDigest(1000));
 plan=await subscriptionRefundSyncPlan({orderId:'s',rows:read(),now:500});
 assert.ok(db.prepare(plan.proof.sql).get(...plan.proof.params));
 assert.equal(run(db,plan.write),0); // default off
 db.exec("UPDATE system_settings SET value='1' WHERE key='partner_refund_sync_enabled'");
 assert.equal(run(db,plan.write),1);assert.equal(run(db,plan.write),0);
 assert.equal(db.prepare("SELECT delta_fen FROM partner_commission_refunds").get().delta_fen,-200);
 const replay=await subscriptionRefundSyncPlan({orderId:'s',rows:read(),now:501});
 assert.equal(replay.write,null);
 assert.ok(db.prepare(replay.proof.sql).get(...replay.proof.params));
 const {reversedSubscriptionReviewPlan,payoutReviewAssertions}=await import('../src/partner-payout-review.mjs');
 const {classifyPaymentEvidence}=await import('../src/partner-payment-proof.mjs');
 const commission={order_domain:'subscription',order_id:'s',buyer_user_id:'b',paid_at:350,applied_at:351,principal_fen:1000,reversed_principal:1000,remaining_fen:0};
 const historicalProof=await reversedSubscriptionReviewPlan(commission,read());
 assert.ok(historicalProof);
 assert.equal(await reversedSubscriptionReviewPlan({...commission,reversed_principal:999},read()),null);
 assert.equal(await reversedSubscriptionReviewPlan({...commission,remaining_fen:1},read()),null);
 assert.equal(classifyPaymentEvidence('subscription',[{transaction_count:1,merchant_provider:'mk99',currency:'CNY',risk_state:'frozen',refund_pending:0,order_status:'refunded',payment_status:'refunded'}]).eligible,false);
 db.exec("INSERT INTO system_settings(key,value,updated_at) VALUES('partner_payout_review_enabled','1',0)");
 const guard=payoutReviewAssertions({partnerId:'p',rows:[{commission,reversedSubscriptionProof:historicalProof}],operationId:'subreview'});
 batch(db,[...guard.checks,guard.cleanup]);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM partner_recovery_assertions").get().n,0);
 db.prepare("DELETE FROM subscription_payment_events WHERE provider_event_id=?").run('sub-risk:'+makeDigest(1000));
 assert.throws(()=>batch(db,[...guard.checks,guard.cleanup]));
 notice(1000,makeDigest(1000));
 db.exec("UPDATE subscription_payment_transactions SET merchant_provider='xiaodou'");
 assert.equal(await subscriptionRefundSyncPlan({orderId:'s',rows:read(),now:502}),null);
});
