// Bounded cyclic keyset scan of immutable commission IDs, independent of
// new accrual and payout flags. Advance even when evidence is inconclusive
// so a permanently ambiguous refund cannot starve later orders. Revisit
// every ledger row on the next cycle. No provider calls or money movement.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const domain=x=>['recharge','subscription'].includes(x);
const fail=()=>{throw new TypeError('PARTNER_REFUND_SWEEP_INVALID');};
export function refundSweepPagePlan({orderDomain,afterId,limit=3}){
 if(!domain(orderDomain)||!(afterId===''||id(afterId))||!Number.isSafeInteger(limit)||limit<1||limit>10)fail();
 return {sql:`SELECT order_id FROM partner_commissions WHERE order_domain=? AND order_id>? ORDER BY order_id LIMIT ?`,params:[orderDomain,afterId,limit]};
}
export function refundSweepAdvancePlan({orderDomain,oldId,nextId,generation,now,wrap=false}){
 if(!domain(orderDomain)||!(oldId===''||id(oldId))||!Number.isSafeInteger(generation)||generation<0||!Number.isSafeInteger(now)||now<=0||
 (wrap?nextId!==''||oldId==='':!id(nextId)||nextId<=oldId))fail();
 return {sql:`UPDATE partner_refund_sweep_cursors SET order_id=?,generation=generation+?,updated_at=?
 WHERE order_domain=? AND order_id=? AND generation=? AND updated_at<=?
 AND (SELECT COUNT(*) FROM system_settings WHERE key IN ('partner_refund_sync_enabled','partner_scheduled_refund_sync_enabled') AND value='1')=2`,
 params:[nextId,wrap?1:0,now,orderDomain,oldId,generation,now]};
}
