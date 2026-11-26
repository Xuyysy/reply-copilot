import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {paymentEvidencePlan} from '../src/partner-payment-proof.mjs';
import {subscriptionRefundCandidatePlan,subscriptionRefundProofPlan} from '../src/partner-subscription-refund.mjs';
import {refundCandidatePlan,refundSyncPlan} from '../src/partner-refund-sync.mjs';
import {discoveryPagePlan,discoveryRepairPagePlan,discoveryEnqueuePlan,cursorAdvancePlan} from '../src/partner-discovery.mjs';
import {refundSweepPagePlan,refundSweepAdvancePlan} from '../src/partner-refund-sweep.mjs';
import {accrualQueuePlan,reopenAccrualPlan} from '../src/partner-accrual-queue.mjs';
import {accrualEnqueuePlan,dueAccrualPlan,recoveryFailurePlan,recoveredAccrualPlan} from '../src/partner-recovery.mjs';
import {attributionPlan,reviewedAccrualBatch} from '../src/partner-accrual-review.mjs';
import {accrualApprovalPlan,approvedDuePlan,approvedAccrualBatch} from '../src/partner-accrual-approval.mjs';
import {partnerPolicyAppendPlan,partnerPolicyAtPlan} from '../src/partner-policy.mjs';
import {recipientAppendPlan} from '../src/partner-alipay.mjs';
import {alipayAdmissionPlan,alipayRejectPlan,alipayStartPlan,alipayOutcomePlan} from '../src/partner-transfer.mjs';
import {allHistoryPayoutGuard,setPayoutApprovePlan} from '../src/partner-payout-set-review.mjs';
import {partnerSummaryPlan} from '../src/partner-payout.mjs';
const proposals=['0025_subscription_xiaodou_rsa2.sql','0027_referral_rewards_v1.sql','partners_v1a_policy_proposal.sql','partners_v1b_ledger_proposal.sql','partners_v1b_recovery_proposal.sql','partners_v1d_payout_proposal.sql','partners_alipay_recipient_proposal.sql','partners_alipay_transfer_proposal.sql','partners_query_indexes_proposal.sql'];
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 // Same actual migrations as payment-v2 fixture; no network or Wrangler.
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 for(const name of proposals)db.exec(readFileSync(new URL('../sql-proposals/'+name,import.meta.url),'utf8'));
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 return db;
}
const now=1000,order={orderDomain:'recharge',orderId:'o',paidAt:350,now};
const facts={...order,partnerUserId:'p',buyerUserId:'b',policyVersion:1,appliedAt:351,holdUntil:451,registeredAt:100,firstAuthorizedAt:200,termMonths:12,currency:'CNY',basis:'product_principal',principalFen:1000,rateBps:2000};
const input={facts,windowId:'w',attempts:0,refundPrincipalFen:250};
const row={transaction_id:'tx',merchant_provider:'mk99',provider_trade_id:'out',provider_payment_id:'trade',buyer_fen:1000,transaction_paid_at:350};
const approval={operation_id:'op',actor_id:'a',snapshot_sha256:'a'.repeat(64),expires_at:now+1000};
const policy={status:'active',level:'standard',rateBps:2000,termMonths:12,expectedVersion:0,reason:'fixture only'};
const args={requestId:'r',recipientVersion:1,payoutId:'x',partnerId:'p',actorId:'a',amountFen:1000,now,reason:'fixture only'};
function explain(db,p){assert.ok(p?.sql);return db.prepare('EXPLAIN QUERY PLAN '+p.sql).all(...p.params).map(r=>r.detail);}
function run(db,p){return Number(db.prepare(p.sql).run(...p.params).changes);}
function batch(db,ps){db.exec('BEGIN');try{for(const p of ps)run(db,p);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
test('real migration stack plus source-only proposals compiles all partner SQL plans and preserves default-off gates',t=>{
 const db=fixture(t);
 const flags=db.prepare("SELECT key,value FROM system_settings WHERE key LIKE 'partner_%'").all();
 assert.ok(flags.length>=10);
 for(const f of flags)assert.equal(f.value,f.key==='partner_payout_min_fen'?'1000':'0',f.key);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_accrual_windows').get().n,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_commissions').get().n,0);
 const guard=allHistoryPayoutGuard({partnerId:'p',operationId:'op'});
 const reviewed=reviewedAccrualBatch({input,row,actorId:'a',operationId:'op',reason:'fixture only'});
 const plans=[partnerPolicyAppendPlan({userId:'p',actorId:'a',now,policy}),partnerPolicyAtPlan('p',now),
  attributionPlan('b',350),accrualEnqueuePlan(order),dueAccrualPlan(now),recoveryFailurePlan({...order,attempts:0,code:'proof_missing'}),
  ...recoveredAccrualPlan(input),...reviewed,
  accrualApprovalPlan({input,digest:approval.snapshot_sha256,actorId:'a',operationId:'op',reason:'fixture only',now}),
  approvedDuePlan(now),...approvedAccrualBatch({approval,digest:approval.snapshot_sha256,work:reviewed,now}),
  accrualQueuePlan('pending',30,{updatedAt:now,domain:'recharge',orderId:'o'}),
  ...reopenAccrualPlan({domain:'recharge',orderId:'o',attempt:1,actorId:'a',operationId:'reopen',reason:'fixture only',now}),
  refundCandidatePlan('o'),refundSyncPlan({orderId:'o',rows:[{transaction_count:1,principal_fen:1000,confirmed_fen:250,recorded_fen:0,principal_refunded_fen:250,transaction_id:'tx',merchant_provider:'mk99'}],now}),
  subscriptionRefundCandidatePlan('o'),subscriptionRefundProofPlan('o',{transaction_id:'tx',provider_trade_id:'out',provider_payment_id:'trade',principal_fen:1000,recorded_fen:0},'a'.repeat(64)),
  recipientAppendPlan({userId:'p',expectedVersion:0,now,sealed:{keyId:'fixture',nonceHex:'0'.repeat(24),ciphertextHex:'0'.repeat(32),accountMask:'a***',nameMask:'b**'}}),
  alipayAdmissionPlan({...args,minFen:1000}),alipayRejectPlan(args),alipayStartPlan(args),alipayOutcomePlan({...args,outcome:'paid',reference:'fixture'}),
  guard.check,guard.cleanup,...setPayoutApprovePlan(args),partnerSummaryPlan('p',now)];
 for(const domain of ['recharge','subscription'])plans.push(paymentEvidencePlan(domain,'o'),discoveryPagePlan({domain,afterAt:0,afterId:'',now}),discoveryRepairPagePlan({domain,fromAt:0,now}),discoveryEnqueuePlan({domain,orderId:'o',now}),cursorAdvancePlan({domain,oldAt:0,oldId:'',nextAt:350,nextId:'o',now}),refundSweepPagePlan({orderDomain:domain,afterId:''}),refundSweepAdvancePlan({orderDomain:domain,oldId:'',nextId:'o',generation:0,now}));
 for(const p of plans)explain(db,p);
 t.diagnostic('Compiled '+plans.length+' SQL statements on actual migration schema; no remote database');
});
test('actual schema supports indexed discovery and 1000-row integer payout allocation',t=>{
 const db=fixture(t);
 for(const [id,role] of [['a','admin'],['p','user'],['b','user']]){
  db.prepare("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash,role) VALUES(?,?,1,1,?,'fixture-hash',?)").run(id,id+'@example.test','fixture-'+id,role);
 }
 db.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'a',1); UPDATE system_settings SET value='1' WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_alipay_recipient_enabled','partner_payout_enabled','partner_payout_requests_enabled','partner_payout_review_enabled')");
 assert.equal(run(db,partnerPolicyAppendPlan({userId:'p',actorId:'a',now:200,policy})),1);
 db.exec("INSERT INTO partner_alipay_recipients VALUES('p',1,'fixture','000000000000000000000000','00000000000000000000000000000000','a***','b**',300)");
 // Synthetic immutable commissions on actual schema, not fabricated paid
 // orders. Evidence assertion MUST fail until provider facts are supplied.
 const insert=db.prepare("INSERT INTO partner_commissions VALUES('recharge',?,'p','b',1,350,351,'product_principal','CNY',1000,2000,200,451,360)");
 db.exec('BEGIN');for(let i=0;i<1000;i++)insert.run('order-'+String(i).padStart(4,'0'));db.exec('COMMIT');
 for(const domain of ['recharge','subscription']){
  const details=explain(db,discoveryPagePlan({domain,afterAt:0,afterId:'',now}));
  assert.ok(details.some(x=>x.includes('partner_discovery_'+domain+'_applied_idx')),details.join('\n'));
 }
 const request={...args,amountFen:150001};
 assert.equal(run(db,alipayAdmissionPlan({...request,minFen:1000})),1);
 const guard=allHistoryPayoutGuard({partnerId:'p',operationId:'missing-proof'});
 assert.throws(()=>batch(db,[guard.check,...setPayoutApprovePlan(request),guard.cleanup]));
 assert.equal(db.prepare('SELECT COUNT(*) n FROM partner_payouts').get().n,0);
 // Allocation benchmark alone, NOT a passing payment evidence test. This
 // direct fixture-only primitive cannot be invoked by production routes.
 const begin=performance.now();batch(db,setPayoutApprovePlan(request));const elapsed=performance.now()-begin;
 const total=db.prepare('SELECT COUNT(*) n,SUM(amount_fen) total FROM partner_payout_items').get();
 assert.equal(total.n,751);assert.equal(total.total,150001);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 t.diagnostic('Local SQLite allocation: 1000 historical rows, 751 items, '+elapsed.toFixed(2)+' ms (not D1 CPU or billed reads)');
});
