// Read-only fiat order evidence adapter. No commission writes or payment hooks.
// Do not use browser/payment callback fields as monetary evidence.
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const integer=(x,min=1)=>Number.isSafeInteger(x)&&x>=min&&x<=1000000000000;
export function paymentEvidencePlan(domain,orderId){
 if(!validId(orderId)||!['recharge','subscription'].includes(domain))throw new TypeError('PARTNER_ORDER_INVALID');
 if(domain==='recharge')return {sql:`SELECT o.id order_id,o.user_id buyer_id,'recharge' order_kind,o.status order_status,
 o.paid_at,o.credited_at applied_at,t.id transaction_id,t.merchant_provider,t.status payment_status,t.risk_state,t.currency,
 t.amount_fen buyer_fen,t.base_amount_fen principal_fen,t.service_fee_fen,t.principal_refunded_fen,
 (SELECT COUNT(*) FROM payment_transactions x WHERE x.order_id=o.id) transaction_count,
 EXISTS(SELECT 1 FROM provider_payment_events e WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
 AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen AND e.currency='CNY') payment_proof,
 EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id AND l.user_id=o.user_id AND l.paid_delta=o.credits)
 AND EXISTS(SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id AND b.user_id=o.user_id AND b.source_kind='purchase' AND b.grant_credits=o.credits) applied_proof,
 EXISTS(SELECT 1 FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status IN ('requested','pending','unknown')) refund_pending,
 COALESCE((SELECT SUM(r.base_amount_fen) FROM payment_refunds r WHERE r.transaction_id=t.id AND r.status='succeeded'),0) refund_proof_fen
 FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id WHERE o.id=? LIMIT 2`,params:[orderId]};
 return {sql:`SELECT o.id order_id,o.user_id buyer_id,o.kind order_kind,o.status order_status,o.paid_at,o.applied_at,
 t.id transaction_id,t.merchant_provider,t.status payment_status,t.risk_state,t.currency,t.amount_fen buyer_fen,
 o.amount_fen principal_fen,0 service_fee_fen,0 principal_refunded_fen,
 (SELECT COUNT(*) FROM subscription_payment_transactions x WHERE x.order_id=o.id) transaction_count,
 EXISTS(SELECT 1 FROM subscription_payment_events e WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
 AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen AND e.body_sha256 IS NOT NULL) payment_proof,
 CASE WHEN o.kind IN ('purchase','renewal') THEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id AND p.user_id=o.user_id)
 WHEN o.kind='upgrade' THEN EXISTS(SELECT 1 FROM subscription_tier_changes c JOIN subscription_periods p ON p.id=c.period_id
 WHERE c.order_id=o.id AND c.period_id=o.target_period_id AND p.user_id=o.user_id AND c.charged_fen=o.amount_fen)
 ELSE 0 END applied_proof,
 CASE WHEN o.status='refund_pending' THEN 1 ELSE 0 END refund_pending,0 refund_proof_fen
 FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=? LIMIT 2`,params:[orderId]};
}
// Conservative preview classification: unknown evidence cannot produce a
// payable amount. CNY principal is a candidate basis, not merchant net.
// The payout-only option admits a fully reversed recharge for debt checks,
// never for new accrual. All other proof and risk guards still apply.
export function classifyPaymentEvidence(domain,rows,{allowFullyReversed=false}={}){
 const blocked=reason=>({eligible:false,reason});
 if(!Array.isArray(rows)||rows.length!==1)return blocked(rows?.length?'ambiguous_transaction':'no_fiat_evidence');
 const r=rows[0];
 if(r.transaction_count!==1)return blocked('ambiguous_transaction');
 if(!['mk99','xiaodou'].includes(r.merchant_provider)||r.currency!=='CNY')return blocked('unsupported_provider');
 if(r.risk_state!=='clear'||r.refund_pending!==0)return blocked('risk_or_pending_refund');
 const fullyReversed=allowFullyReversed&&domain==='recharge'&&integer(r.principal_fen)&&r.principal_refunded_fen===r.principal_fen&&r.refund_proof_fen===r.principal_fen;
 const paid=r.order_status==='paid'&&r.payment_status==='paid';
 const refunded=fullyReversed&&r.order_status==='refunded'&&r.payment_status==='refunded';
 if(!paid&&!refunded)return blocked('not_paid');
 if(r.payment_proof!==1||r.applied_proof!==1||!Number.isSafeInteger(r.paid_at)||r.paid_at<=0||
 !Number.isSafeInteger(r.applied_at)||r.applied_at<r.paid_at)return blocked('missing_settlement_proof');
 if(!integer(r.principal_fen)||!integer(r.buyer_fen)||r.principal_fen>r.buyer_fen)return blocked('invalid_amount_snapshot');
 if(domain==='subscription'&&(!['purchase','renewal','upgrade'].includes(r.order_kind)||r.principal_fen!==r.buyer_fen))return blocked('invalid_subscription_amount');
 if(domain==='recharge'&&(!integer(r.principal_refunded_fen,0)||r.refund_proof_fen!==r.principal_refunded_fen||
 (r.principal_refunded_fen>r.principal_fen||r.principal_refunded_fen===r.principal_fen&&!fullyReversed)))return blocked('refund_requires_reconciliation');
 return {eligible:true,reason:'candidate_only',principalFen:r.principal_fen,buyerFen:r.buyer_fen,
 refundedPrincipalFen:r.principal_refunded_fen,paidAt:r.paid_at,appliedAt:r.applied_at,provider:r.merchant_provider,kind:r.order_kind};
}
