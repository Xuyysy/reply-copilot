// Explicit per-order approval, then bounded background posting. The approval
// attests only to an exact snapshot; it is not automated fraud detection.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const int=(x,min=1)=>Number.isSafeInteger(x)&&x>=min;
const gate="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_accrual_review_enabled','partner_scheduled_accrual_enabled') AND value='1')=4";
const fail=()=>{throw new TypeError('PARTNER_APPROVAL_INVALID');};
export async function accrualSnapshot(input,row){
 const f=input.facts;
 // now is intentionally excluded: execution occurs after the approval.
 const fields=[f.orderDomain,f.orderId,f.partnerUserId,f.buyerUserId,f.policyVersion,f.paidAt,f.appliedAt,
 f.holdUntil,f.registeredAt,f.firstAuthorizedAt,f.termMonths,f.currency,f.basis,f.principalFen,f.rateBps,
 input.windowId,input.attempts,input.refundPrincipalFen,row.transaction_id,row.merchant_provider,row.provider_trade_id,row.provider_payment_id,row.transaction_paid_at,row.buyer_fen];
 if(fields.some(x=>x===undefined))fail();
 const b=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(fields)));
 return Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
}
export function accrualApprovalPlan({input,digest,actorId,operationId,reason,now}){
 if(!id(actorId)||!id(operationId)||!int(now)||! /^[a-f0-9]{64}$/.test(digest)||typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500)fail();
 const f=input.facts;
 return {sql:`INSERT INTO partner_accrual_approvals(operation_id,order_domain,order_id,attempt,actor_id,reason,snapshot_sha256,approved_at,expires_at)
 SELECT ?,j.order_domain,j.order_id,j.attempts,?,?,?,?,? FROM partner_accrual_jobs j
 WHERE j.order_domain=? AND j.order_id=? AND j.window_id=? AND j.paid_at=? AND j.state='pending' AND j.attempts=? AND j.next_attempt_at<=?
 AND ${gate} AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=? AND u.role='admin'
 AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 ON CONFLICT DO NOTHING`,params:[operationId,actorId,reason.trim(),digest,now,now+3600000,f.orderDomain,f.orderId,input.windowId,f.paidAt,input.attempts,now,actorId]};
}
export function approvedDuePlan(now,limit=2){
 if(!int(now)||!int(limit)||limit>5)fail();
 return {sql:`SELECT a.* FROM partner_accrual_approvals a JOIN partner_accrual_jobs j ON j.order_domain=a.order_domain AND j.order_id=a.order_id
 WHERE j.state='pending' AND j.attempts=a.attempt AND j.next_attempt_at<=? AND ${gate}
 ORDER BY a.approved_at,a.operation_id LIMIT ?`,params:[now,limit]};
}
// Guard exact immutable approval in the same transaction as the normal
// reviewed accrual batch. Existing batch guards reread all payment facts.
export function approvedAccrualBatch({approval,digest,work,now}){
 if(!approval||!Array.isArray(work)||!work.length||!int(now)||digest!==approval.snapshot_sha256||now>=approval.expires_at)return null;
 const claim='approval:'+approval.operation_id;
 return [{sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN ${gate}
 AND EXISTS(SELECT 1 FROM partner_accrual_approvals a JOIN partner_accrual_jobs j ON j.order_domain=a.order_domain AND j.order_id=a.order_id
 WHERE a.operation_id=? AND a.snapshot_sha256=? AND a.actor_id=? AND a.approved_at<=? AND a.expires_at>?
 AND j.state='pending' AND j.attempts=a.attempt) THEN 1 ELSE 0 END`,
 params:[claim,approval.operation_id,digest,approval.actor_id,now,now]},...work,
 {sql:'DELETE FROM partner_recovery_assertions WHERE id=?',params:[claim]}];
}
