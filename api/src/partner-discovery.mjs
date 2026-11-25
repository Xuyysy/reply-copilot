// Non-production bounded discovery of persisted paid orders. No cash posting,
// no full-table scan in payment callbacks. Manual risk review still required.
// Paid timestamps may precede entitlement application, so page by applied time,
// not paid time. A lookback/reconciliation mechanism is still needed for
// arbitrarily delayed or retroactively corrected timestamps.
const int=(x,min=1,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const fail=()=>{throw new TypeError('PARTNER_DISCOVERY_INVALID');};
export function discoveryPagePlan({domain,afterAt,afterId,now,limit=20}){
 if(!['recharge','subscription'].includes(domain)||!int(afterAt,0)||!(afterId===''||id(afterId))||!int(now)||!int(limit,1,50))fail();
 const orders=domain==='recharge'?'recharge_orders':'subscription_orders';
 const applied=domain==='recharge'?'credited_at':'applied_at';
 return {sql:`SELECT o.id order_id,o.paid_at,o.${applied} applied_at FROM ${orders} o
 WHERE o.${applied} IS NOT NULL AND o.${applied}<=?
 AND (o.${applied}>? OR (o.${applied}=? AND o.id>?))
 ORDER BY o.${applied},o.id LIMIT ?`,params:[now,afterAt,afterAt,afterId,limit]};
}
// Candidate enqueue derives order ID, paid time, existing referral and
// activation window from persisted records. Risk/proof review happens later.
export function discoveryEnqueuePlan({domain,orderId,now}){
 if(!['recharge','subscription'].includes(domain)||!id(orderId)||!int(now))fail();
 const orders=domain==='recharge'?'recharge_orders':'subscription_orders';
 const applied=domain==='recharge'?'credited_at':'applied_at';
 return {sql:`INSERT INTO partner_accrual_jobs(order_domain,order_id,window_id,paid_at,created_at,state,next_attempt_at,last_code,updated_at)
 SELECT ?,o.id,w.id,o.paid_at,?,'pending',?,'discovered',?
 FROM ${orders} o JOIN referral_invites r ON r.invited_user_id=o.user_id AND r.registered_at<=o.paid_at
 JOIN partner_accrual_windows w ON w.starts_at<=o.paid_at AND (w.ends_at IS NULL OR o.paid_at<w.ends_at)
 WHERE o.id=? AND o.status='paid' AND o.paid_at>0 AND o.${applied}>=o.paid_at AND o.${applied}<=?
 AND EXISTS(SELECT 1 FROM partner_policy_versions p WHERE p.user_id=r.inviter_user_id AND p.effective_at<=o.paid_at)
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_program_enabled','partner_cash_accrual_enabled','partner_discovery_enabled') AND value='1')=3
 ON CONFLICT(order_domain,order_id) DO NOTHING`,params:[domain,now,now,now,orderId,now]};
}
export function cursorAdvancePlan({domain,oldAt,oldId,nextAt,nextId,now}){
 if(!['recharge','subscription'].includes(domain)||!int(oldAt,0)||!int(nextAt,oldAt)||!(oldId===''||id(oldId))||!id(nextId)||!int(now)||nextAt>now||
 (oldAt===nextAt&&nextId<=oldId))fail();
 return {sql:`UPDATE partner_discovery_cursors SET applied_at=?,order_id=?,updated_at=?
 WHERE order_domain=? AND applied_at=? AND order_id=? AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_discovery_enabled' AND value='1')`,
 params:[nextAt,nextId,now,domain,oldAt,oldId]};
}
