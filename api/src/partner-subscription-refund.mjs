// MK99 full subscription refund only. The existing subscription-risk.ts
// persists an explicit full refund as both refunded statuses + frozen risk,
// and hashes [outTradeNo,tradeNo,'TRADE_REFUND',refundAmountFen].
// Unknown-amount notices may store the original amount in amount_fen, so a
// matching amount alone is insufficient: verify the exact explicit digest.
// No provider requests, no real refunds, no changes to subscription rights.
import {refundInsertPlan} from './partner-ledger.mjs';
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const pos=x=>Number.isSafeInteger(x)&&x>0&&x<=1000000000000;
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
export function subscriptionRefundCandidatePlan(orderId){
 if(!validId(orderId))throw new TypeError('PARTNER_SUB_REFUND_INVALID');
 return {sql:`SELECT c.order_id,c.buyer_user_id,c.principal_fen,c.paid_at,c.applied_at,c.created_at,
 t.id transaction_id,t.provider_trade_id,t.provider_payment_id,t.merchant_provider,
 (SELECT COUNT(*) FROM subscription_payment_transactions x WHERE x.order_id=o.id) transaction_count,
 COALESCE((SELECT MAX(r.cumulative_principal_fen) FROM partner_commission_refunds r
 WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0) recorded_fen
 FROM partner_commissions c JOIN subscription_orders o ON o.id=c.order_id AND o.user_id=c.buyer_user_id
 JOIN subscription_payment_transactions t ON t.order_id=o.id
 JOIN partner_payment_identity_claims k ON k.order_domain=c.order_domain AND k.order_id=c.order_id
 AND k.merchant_provider=t.merchant_provider AND k.provider_trade_id=t.provider_trade_id AND k.provider_payment_id=t.provider_payment_id
 WHERE c.order_domain='subscription' AND c.order_id=? AND o.kind IN ('purchase','renewal','upgrade')
 AND o.status='refunded' AND t.status='refunded' AND t.risk_state='frozen'
 AND o.paid_at=c.paid_at AND t.paid_at=c.paid_at AND o.applied_at=c.applied_at AND t.amount_fen=o.amount_fen AND o.amount_fen=c.principal_fen
 AND t.currency='CNY' AND t.merchant_provider='mk99'
 AND t.provider_trade_id IS NOT NULL AND t.provider_payment_id IS NOT NULL
 AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.merchant_provider='mk99'
 AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen AND e.body_sha256 IS NOT NULL)
 AND (CASE WHEN o.kind IN ('purchase','renewal') THEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id AND p.user_id=o.user_id)
 ELSE EXISTS(SELECT 1 FROM subscription_tier_changes k JOIN subscription_periods p ON p.id=k.period_id
 WHERE k.order_id=o.id AND k.period_id=o.target_period_id AND k.charged_fen=o.amount_fen AND p.user_id=o.user_id) END)
 LIMIT 2`,params:[orderId]};
}
export async function explicitFullRefundDigest(rows){
 if(!Array.isArray(rows)||rows.length!==1)return null;
 const r=rows[0];
 if(r.transaction_count!==1||r.merchant_provider!=='mk99'||!pos(r.principal_fen)||
 typeof r.provider_trade_id!=='string'||!r.provider_trade_id||typeof r.provider_payment_id!=='string'||!r.provider_payment_id||
 !Number.isSafeInteger(r.recorded_fen)||r.recorded_fen<0||r.recorded_fen>r.principal_fen)return null;
 return hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([
 r.provider_trade_id,r.provider_payment_id,'TRADE_REFUND',r.principal_fen]))));
}
export function subscriptionRefundProofPlan(orderId,row,digest){
 if(!validId(orderId)||!row||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new TypeError('PARTNER_SUB_REFUND_INVALID');
 const p=subscriptionRefundCandidatePlan(orderId);
 return {sql:`SELECT x.* FROM (${p.sql}) x WHERE x.transaction_count=1 AND x.transaction_id=?
 AND x.provider_trade_id=? AND x.provider_payment_id=? AND x.principal_fen=? AND x.recorded_fen=?
 AND EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=x.transaction_id
 AND e.merchant_provider='mk99' AND e.event_type='TRADE_REFUND' AND e.amount_fen=x.principal_fen
 AND e.body_sha256=? AND e.provider_event_id=?)`,
 params:[...p.params,row.transaction_id,row.provider_trade_id,row.provider_payment_id,row.principal_fen,row.recorded_fen,digest,'sub-risk:'+digest]};
}
export async function subscriptionRefundSyncPlan({orderId,rows,now}){
 const digest=await explicitFullRefundDigest(rows);
 if(!digest)return null;
 const row=rows[0],proof=subscriptionRefundProofPlan(orderId,row,digest);
 if(row.recorded_fen===row.principal_fen)return {proof,write:null};
 const p=refundInsertPlan({orderDomain:'subscription',orderId,refundEventId:'sub-risk:'+digest,cumulativePrincipalFen:row.principal_fen,now});
 p.sql=p.sql.replace('ON CONFLICT DO NOTHING',`
 AND EXISTS(SELECT 1 FROM (${proof.sql}) e WHERE e.principal_fen=c.principal_fen)
 AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_refund_sync_enabled' AND value='1')
 ON CONFLICT DO NOTHING`);
 p.params.push(...proof.params);
 return {proof,write:p};
}
