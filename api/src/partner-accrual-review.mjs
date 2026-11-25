// Non-production pilot transaction adapter, no payment webhooks or cron.
// Independent operator risk review is mandatory. All amounts and identities
// derive from persisted evidence, never from a public request body.
import {paymentEvidencePlan,classifyPaymentEvidence} from './partner-payment-proof.mjs';
import {recoveredAccrualPlan} from './partner-recovery.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const pos=x=>Number.isSafeInteger(x)&&x>0;
const fail=()=>{throw new TypeError('PARTNER_ACCRUAL_REVIEW_INVALID');};
export function attributionPlan(buyerId,paidAt){
 if(!id(buyerId)||!pos(paidAt))fail();
 return {sql:`SELECT r.inviter_user_id,r.registered_at,p.version,p.status,p.rate_bps,p.term_months,
 (SELECT MIN(v.effective_at) FROM partner_policy_versions v WHERE v.user_id=p.user_id AND v.status='active') first_authorized_at
 FROM referral_invites r JOIN partner_policy_versions p ON p.user_id=r.inviter_user_id
 JOIN users u ON u.id=r.inviter_user_id JOIN users b ON b.id=r.invited_user_id
 WHERE r.invited_user_id=? AND r.registered_at<=? AND r.inviter_user_id<>r.invited_user_id
 AND p.effective_at<=? AND u.role='user' AND b.role='user' AND u.status='active' AND b.status='active'
 AND u.is_test_account=0 AND b.is_test_account=0 AND u.archived_at IS NULL AND b.archived_at IS NULL
 AND u.email_verified_at IS NOT NULL AND b.email_verified_at IS NOT NULL
 ORDER BY p.version DESC LIMIT 1`,params:[buyerId,paidAt,paidAt]};
}
export function reviewedFacts({orderDomain,orderId,rows,attribution,job,now}){
 const proof=classifyPaymentEvidence(orderDomain,rows);
 if(!proof.eligible||!('principalFen' in proof)||!attribution||attribution.status!=='active'||
 !job||job.state!=='pending'||job.paid_at!==proof.paidAt||!pos(job.hold_ms)||!pos(attribution.first_authorized_at))return null;
 return {facts:{orderDomain,orderId,partnerUserId:attribution.inviter_user_id,buyerUserId:rows[0].buyer_id,
 policyVersion:attribution.version,paidAt:proof.paidAt,appliedAt:proof.appliedAt,now,
 holdUntil:proof.appliedAt+job.hold_ms,registeredAt:attribution.registered_at,firstAuthorizedAt:attribution.first_authorized_at,
 termMonths:attribution.term_months,currency:'CNY',basis:'product_principal',principalFen:proof.principalFen,rateBps:attribution.rate_bps},
 windowId:job.window_id,attempts:job.attempts,refundPrincipalFen:proof.refundedPrincipalFen};
}
// Re-read the same actual provider/entitlement evidence in the atomic batch.
// Equality checks catch refunds/risk changes between preview and commit.
export function reviewedAccrualBatch({input,row,actorId,reason,operationId}){
 if(!input||!row||!id(actorId)||!id(operationId)||typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500)fail();
 const {facts,refundPrincipalFen}=input;
 const proof=paymentEvidencePlan(facts.orderDomain,facts.orderId);
 const work=recoveredAccrualPlan(input);
 if(!work)return null;
 const assertId='review:'+operationId;
 const check={sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN
 EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=?
 AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_accrual_review_enabled' AND value='1')
 AND EXISTS(SELECT 1 FROM (${proof.sql}) e WHERE e.transaction_count=1 AND e.transaction_id=?
 AND e.merchant_provider=? AND e.provider_trade_id=? AND e.provider_payment_id=? AND e.identity_count=1 AND e.transaction_paid_at=e.paid_at AND e.merchant_provider IN ('mk99','xiaodou') AND e.currency='CNY'
 AND e.order_status='paid' AND e.payment_status='paid' AND e.risk_state='clear' AND e.refund_pending=0
 AND e.payment_proof=1 AND e.applied_proof=1 AND e.buyer_id=? AND e.paid_at=? AND e.applied_at=?
 AND e.principal_fen=? AND e.buyer_fen=? AND e.principal_refunded_fen=? AND e.refund_proof_fen=?)
 THEN 1 ELSE 0 END`,params:[assertId,actorId,...proof.params,row.transaction_id,row.merchant_provider,row.provider_trade_id,row.provider_payment_id,facts.buyerUserId,facts.paidAt,facts.appliedAt,
 facts.principalFen,row.buyer_fen,refundPrincipalFen,refundPrincipalFen]};
 const audit={sql:`INSERT INTO partner_accrual_review_audits(operation_id,order_domain,order_id,actor_id,reason,reviewed_at)
 VALUES(?,?,?,?,?,?)`,params:[operationId,facts.orderDomain,facts.orderId,actorId,reason.trim(),facts.now]};
 const identity={sql:`INSERT INTO partner_payment_identity_claims(merchant_provider,provider_trade_id,provider_payment_id,order_domain,order_id,created_at) VALUES(?,?,?,?,?,?)`,params:[row.merchant_provider,row.provider_trade_id,row.provider_payment_id,facts.orderDomain,facts.orderId,facts.now]};
 return [check,...work,identity,audit,{sql:'DELETE FROM partner_recovery_assertions WHERE id=?',params:[assertId]}];
}
