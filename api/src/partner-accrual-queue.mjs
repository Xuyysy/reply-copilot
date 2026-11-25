// Bounded administrator queue; no identity or payment secrets in list.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const gate="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_accrual_review_enabled') AND value='1')=3";
export function accrualQueuePlan(state,limit=30){
 if(!['pending','review','done'].includes(state)||!Number.isSafeInteger(limit)||limit<1||limit>30)throw new TypeError('PARTNER_QUEUE_INVALID');
 return {sql:`SELECT j.order_domain,j.order_id,j.state,j.attempts,j.last_code,j.paid_at,j.next_attempt_at,j.updated_at,
 a.expires_at approval_expires_at FROM partner_accrual_jobs j LEFT JOIN partner_accrual_approvals a
 ON a.order_domain=j.order_domain AND a.order_id=j.order_id AND a.attempt=j.attempts
 WHERE j.state=? ORDER BY j.updated_at DESC,j.order_domain,j.order_id LIMIT ?`,params:[state,limit]};
}
// Never reset attempts or revive a recorded commission. Reopen consumes one
// attempt and requires a new review; the old approval cannot authorize it.
export function reopenAccrualPlan({domain,orderId,attempt,actorId,operationId,reason,now}){
 if(!['recharge','subscription'].includes(domain)||!id(orderId)||!id(actorId)||!id(operationId)||
 !Number.isSafeInteger(attempt)||attempt<0||attempt>=19||!Number.isSafeInteger(now)||now<=0||
 typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500)throw new TypeError('PARTNER_QUEUE_INVALID');
 const claim='reopen:'+operationId;
 return [
 {sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN ${gate}
 AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND a.user_id=?
 AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND EXISTS(SELECT 1 FROM partner_accrual_jobs j WHERE j.order_domain=? AND j.order_id=? AND j.state='review' AND j.attempts=? AND j.updated_at<=?)
 AND NOT EXISTS(SELECT 1 FROM partner_commissions c WHERE c.order_domain=? AND c.order_id=?) THEN 1 ELSE 0 END`,params:[claim,actorId,domain,orderId,attempt,now,domain,orderId]},
 {sql:"UPDATE partner_accrual_jobs SET state='pending',attempts=attempts+1,last_code='reopened',next_attempt_at=?,updated_at=? WHERE order_domain=? AND order_id=? AND state='review' AND attempts=?",params:[now,now,domain,orderId,attempt]},
 {sql:"INSERT INTO partner_accrual_reopen_audits(operation_id,order_domain,order_id,previous_attempt,actor_id,reason,created_at) VALUES(?,?,?,?,?,?,?)",params:[operationId,domain,orderId,attempt,actorId,reason.trim(),now]},
 {sql:'DELETE FROM partner_recovery_assertions WHERE id=?',params:[claim]}
 ];
}
