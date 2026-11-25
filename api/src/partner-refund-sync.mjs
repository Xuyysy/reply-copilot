// Only confirmed persisted fiat recharge refunds; provider risk signals,
// requested/pending/unknown refunds and subscription refund semantics are NOT
// translated into financial reversals. No refund or payout API calls.
import {refundInsertPlan} from './partner-ledger.mjs';
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const int=(x,min=1)=>Number.isSafeInteger(x)&&x>=min&&x<=1000000000000;
export function refundCandidatePlan(orderId){
 if(!id(orderId))throw new TypeError('PARTNER_REFUND_SYNC_INVALID');
 return {sql:`SELECT c.order_id,c.buyer_user_id,c.principal_fen,c.created_at,
 t.id transaction_id,t.merchant_provider,t.principal_refunded_fen,
 (SELECT COUNT(*) FROM payment_transactions x WHERE x.order_id=o.id) transaction_count,
 COALESCE((SELECT SUM(r.base_amount_fen) FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status='succeeded'),0) confirmed_fen,
 COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0) recorded_fen
 FROM partner_commissions c JOIN recharge_orders o ON o.id=c.order_id AND o.user_id=c.buyer_user_id
 JOIN payment_transactions t ON t.order_id=o.id
 WHERE c.order_domain='recharge' AND c.order_id=? AND t.currency='CNY' AND t.merchant_provider IN ('mk99','xiaodou')
 AND t.base_amount_fen=c.principal_fen AND t.status IN ('paid','refunded') LIMIT 2`,params:[orderId]};
}
export function confirmedRefundAmount(rows){
 if(!Array.isArray(rows)||rows.length!==1)return null;
 const r=rows[0];
 if(r.transaction_count!==1||!int(r.principal_fen)||!int(r.confirmed_fen,0)||!int(r.recorded_fen,0)||
 r.confirmed_fen!==r.principal_refunded_fen||r.confirmed_fen>r.principal_fen||r.confirmed_fen<r.recorded_fen)return null;
 return r.confirmed_fen;
}
export function refundSyncPlan({orderId,rows,now}){
 const amount=confirmedRefundAmount(rows);
 if(amount===null||amount<=rows[0].recorded_fen)return null;
 const r=rows[0],proof=refundCandidatePlan(orderId);
 const plan=refundInsertPlan({orderDomain:'recharge',orderId,refundEventId:'sync:'+amount,cumulativePrincipalFen:amount,now});
 plan.sql=plan.sql.replace('ON CONFLICT DO NOTHING',`
 AND EXISTS(SELECT 1 FROM (${proof.sql}) e WHERE e.transaction_count=1 AND e.transaction_id=? AND e.merchant_provider=?
 AND e.confirmed_fen=? AND e.principal_refunded_fen=? AND e.recorded_fen=? AND e.principal_fen=c.principal_fen)
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_refund_sync_enabled' AND value='1')
 ON CONFLICT DO NOTHING`);
 plan.params.push(...proof.params,r.transaction_id,r.merchant_provider,amount,amount,r.recorded_fen);
 return plan;
}
