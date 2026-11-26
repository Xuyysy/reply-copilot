// Fixture-only manual settlement primitives. Never call from public JSON.
// The caller must independently verify order/provider risk and payout details,
// and apply all statements in a single atomic D1.batch. No money transfer here.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9:_-]{1,160}$/.test(x);
const int=x=>Number.isSafeInteger(x)&&x>0;
const fail=()=>{throw new TypeError('PARTNER_PAYOUT_INVALID');};
export function payoutReservePlan({payoutId,partnerId,actorId,now,reason,items}){
 if(!id(payoutId)||!id(partnerId)||!id(actorId)||partnerId===actorId||!int(now)||
 typeof reason!=='string'||reason.trim().length<8||reason.trim().length>500||
 !Array.isArray(items)||items.length<1||items.length>30)fail();
 const keys=new Set();let total=0;
 for(const i of items){
  if(!i||!['recharge','subscription'].includes(i.orderDomain)||!id(i.orderId)||!int(i.amountFen))fail();
  const key=i.orderDomain+':'+i.orderId;if(keys.has(key))fail();keys.add(key);total+=i.amountFen;
 }
 if(!int(total)||total>1000000000000)fail();
 const statements=[{sql:`INSERT INTO partner_payouts(id,partner_user_id,amount_fen,status,created_at,created_by,reason)
 SELECT ?,?,?,'reserved',?,?,? WHERE EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_enabled' AND value='1')
 AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id WHERE a.id=1 AND u.id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=? AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)`,
 params:[payoutId,partnerId,total,now,actorId,reason.trim(),actorId,partnerId]}];
 for(const i of items)statements.push({sql:'INSERT INTO partner_payout_items(payout_id,order_domain,order_id,amount_fen) VALUES(?,?,?,?)',params:[payoutId,i.orderDomain,i.orderId,i.amountFen]});
 return statements;
}
export function payoutResolvePlan({payoutId,actorId,now,status,transferReference=null}){
 if(!id(payoutId)||!id(actorId)||!int(now)||!['paid','cancelled'].includes(status)||
 (status==='paid'?typeof transferReference!=='string'||!transferReference.trim()||transferReference.length>160:transferReference!==null))fail();
 return {sql:`UPDATE partner_payouts SET status=?,resolved_at=?,resolved_by=?,transfer_reference=?
 WHERE id=? AND status='reserved' AND EXISTS(SELECT 1 FROM site_administrator a JOIN users u ON u.id=a.user_id
 WHERE a.id=1 AND u.id=? AND u.role='admin' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND (?='cancelled' OR EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_enabled' AND value='1'))`,
 params:[status,now,actorId,transferReference?.trim()??null,payoutId,actorId,status]};
}
// A reversal after payment creates an outstanding debt, not a rewrite of a
// paid transfer. No claim of withdrawable balance: risk verification remains.
export function partnerSummaryPlan(partnerId,now){
 if(!id(partnerId)||!int(now))fail();
 return {sql:`WITH net AS (
 SELECT c.order_domain,c.order_id,c.buyer_user_id,c.commission_fen,c.hold_until,
 c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0) net_fen
 FROM partner_commissions c WHERE c.partner_user_id=?
 ), totals AS (SELECT COUNT(*) orders,COUNT(DISTINCT buyer_user_id) buyers,COALESCE(SUM(commission_fen),0) gross_fen,
 COALESCE(SUM(net_fen),0) net_fen,COALESCE(SUM(CASE WHEN hold_until>? THEN net_fen ELSE 0 END),0) held_fen FROM net),
 payouts AS (SELECT COALESCE(SUM(CASE WHEN status='paid' THEN amount_fen ELSE 0 END),0) paid_fen,
 COALESCE(SUM(CASE WHEN status='reserved' THEN amount_fen ELSE 0 END),0) reserved_fen FROM partner_payouts WHERE partner_user_id=?)
 SELECT totals.*,payouts.*,net_fen-paid_fen-reserved_fen outstanding_fen FROM totals,payouts`,params:[partnerId,now,partnerId]};
}
