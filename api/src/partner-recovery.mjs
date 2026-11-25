// Isolated recovery primitives, NOT connected to production payment/cron.
// Trusted adapter must independently validate provider, refund, fraud, and
// immutable order facts. Operator must approve basis/hold/window explicitly.
import {commissionInsertPlan,refundInsertPlan} from './partner-ledger.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const int=(x,min=1,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const domain=x=>['recharge','subscription'].includes(x);
const fail=()=>{throw new TypeError('PARTNER_RECOVERY_INVALID');};
const gate="(SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled') AND value='1')=2";
export function accrualEnqueuePlan({orderDomain,orderId,paidAt,now}){
 if(!domain(orderDomain)||!id(orderId)||!int(paidAt)||!int(now,paidAt))fail();
 return {sql:`INSERT INTO partner_accrual_jobs(order_domain,order_id,window_id,paid_at,created_at,state,next_attempt_at,last_code,updated_at)
 SELECT ?,?,w.id,?,?,'pending',?,'queued',? FROM partner_accrual_windows w
 WHERE ${gate} AND w.starts_at<=? AND (w.ends_at IS NULL OR ?<w.ends_at)
 ON CONFLICT(order_domain,order_id) DO NOTHING`,params:[orderDomain,orderId,paidAt,now,now,now,paidAt,paidAt]};
}
export function dueAccrualPlan(now,limit=20){
 if(!int(now)||!int(limit,1,50))fail();
 return {sql:`SELECT order_domain,order_id,window_id,paid_at,attempts FROM partner_accrual_jobs
 WHERE state='pending' AND next_attempt_at<=? AND attempts<20
 ORDER BY next_attempt_at,order_domain,order_id LIMIT ?`,params:[now,limit]};
}
export function recoveryFailurePlan({orderDomain,orderId,attempts,now,code,review=false}){
 if(!domain(orderDomain)||!id(orderId)||!int(attempts,0,19)||!int(now)||!['temporary_failure','proof_missing','risk_review','refund_review','policy_review','window_review'].includes(code))fail();
 const terminal=review||attempts>=19;
 const next=terminal?now:now+Math.min(3600000,30000*2**attempts);
 return {sql:`UPDATE partner_accrual_jobs SET state=?,attempts=attempts+1,next_attempt_at=?,last_code=?,updated_at=?
 WHERE order_domain=? AND order_id=? AND state='pending' AND attempts=? AND next_attempt_at<=?`,
 params:[terminal?'review':'pending',next,code,now,orderDomain,orderId,attempts,now]};
}
// Compose a transaction only from trusted, freshly verified facts. Existing
// refund before accrual is posted atomically with the original gross commission.
// The final UPDATE trigger rejects a done transition without the exact ledger.
// Caller MUST check all affected rows, including replay/zero-change cases.
export function recoveredAccrualPlan({facts,windowId,attempts,refundPrincipalFen=0}){
 if(!facts||!id(windowId)||!int(attempts,0,19)||!int(refundPrincipalFen,0)||refundPrincipalFen>=facts.principalFen)fail();
 const p=commissionInsertPlan(facts);
 if(!p)return null;
 const {orderDomain,orderId,paidAt,now,appliedAt,holdUntil}=facts;
 if(!domain(orderDomain)||!id(orderId))fail();
 p.sql=p.sql.replace("ON CONFLICT(order_domain,order_id) DO NOTHING",`
 AND EXISTS(SELECT 1 FROM partner_accrual_jobs j JOIN partner_accrual_windows w ON w.id=j.window_id
 WHERE j.order_domain=? AND j.order_id=? AND j.paid_at=? AND j.window_id=? AND j.state='pending'
 AND j.attempts=? AND j.next_attempt_at<=? AND w.basis='product_principal' AND w.starts_at<=j.paid_at
 AND (w.ends_at IS NULL OR j.paid_at<w.ends_at) AND ?=CAST(? AS INTEGER)+w.hold_ms)
 ON CONFLICT(order_domain,order_id) DO NOTHING`);
 p.params.push(orderDomain,orderId,paidAt,windowId,attempts,now,holdUntil,appliedAt);
 const assertionId=orderDomain+':'+orderId+':'+attempts;
 const pre={sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN ${gate}
 AND EXISTS(SELECT 1 FROM partner_accrual_jobs j JOIN partner_accrual_windows w ON w.id=j.window_id
 WHERE j.order_domain=? AND j.order_id=? AND j.window_id=? AND j.paid_at=? AND j.state='pending'
 AND j.attempts=? AND j.next_attempt_at<=? AND w.starts_at<=j.paid_at AND (w.ends_at IS NULL OR j.paid_at<w.ends_at)
 AND ?=CAST(? AS INTEGER)+w.hold_ms)
 AND NOT EXISTS(SELECT 1 FROM partner_commissions c WHERE c.order_domain=? AND c.order_id=?)
 THEN 1 ELSE 0 END`,params:[assertionId,orderDomain,orderId,windowId,paidAt,attempts,now,holdUntil,appliedAt,orderDomain,orderId]};
 // Pre-existing ledger is deliberately sent to manual reconciliation rather
 // than silently mutating it; the normal atomic path cannot leave one behind.
 const statements=[pre,p];
 if(refundPrincipalFen>0){
 const refund=refundInsertPlan({orderDomain,orderId,refundEventId:'recovery:'+refundPrincipalFen,cumulativePrincipalFen:refundPrincipalFen,now});
 // Any missing gross row or stale refund total is rejected by the final completion check.
 statements.push(refund);
 }
 statements.push({sql:`UPDATE partner_accrual_jobs SET state='done',attempts=attempts+1,next_attempt_at=?,last_code='recorded',updated_at=?
 WHERE order_domain=? AND order_id=? AND window_id=? AND state='pending' AND attempts=? AND next_attempt_at<=?
 AND ${gate} AND EXISTS(SELECT 1 FROM partner_commissions c WHERE c.order_domain=? AND c.order_id=?
 AND c.paid_at=? AND c.applied_at=? AND c.partner_user_id=? AND c.buyer_user_id=? AND c.policy_version=?
 AND c.principal_fen=? AND c.rate_bps=? AND c.hold_until=?
 AND COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)=?)`,
 params:[now,now,orderDomain,orderId,windowId,attempts,now,orderDomain,orderId,paidAt,appliedAt,facts.partnerUserId,facts.buyerUserId,facts.policyVersion,facts.principalFen,facts.rateBps,holdUntil,refundPrincipalFen]});
 statements.push({sql:`INSERT INTO partner_recovery_assertions(id,ok) SELECT ?,CASE WHEN EXISTS(
 SELECT 1 FROM partner_accrual_jobs WHERE order_domain=? AND order_id=? AND window_id=? AND state='done'
 AND attempts=? AND updated_at=?) THEN 1 ELSE 0 END`,params:[assertionId+':done',orderDomain,orderId,windowId,attempts+1,now]});
 statements.push({sql:'DELETE FROM partner_recovery_assertions WHERE id IN (?,?)',params:[assertionId,assertionId+':done']});
 return statements;
}
