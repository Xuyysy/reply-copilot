// Read-only evidence for already settled BoltUtil orders. No provider calls,
// exchange-rate lookup, new ledger rows, or use of user-reported payment data.
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(x);
const int=(x,min=1,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(x)&&x>=min&&x<=max;
const networks=new Set(['TRC20','POLYGON','BEP20','ERC20','SOLANA']);
export function boltCommissionEvidencePlan(domain,orderId){
 if(!id(orderId)||!['recharge','subscription'].includes(domain))throw new TypeError('PARTNER_ORDER_INVALID');
 const credit=domain==='recharge',table=credit?'recharge_orders':'subscription_orders',link=credit?'credit_order_id':'subscription_order_id',fiat=credit?'payment_transactions':'subscription_payment_transactions';
 const applied=credit?`EXISTS(SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id AND l.user_id=o.user_id AND l.paid_delta=o.credits)
 AND EXISTS(SELECT 1 FROM credit_batches c WHERE c.source_order_id=o.id AND c.user_id=o.user_id AND c.source_kind='purchase' AND c.grant_credits=o.credits)`:
 `CASE WHEN o.kind IN ('purchase','renewal') THEN EXISTS(SELECT 1 FROM subscription_periods p WHERE p.source_order_id=o.id AND p.user_id=o.user_id)
 WHEN o.kind='upgrade' THEN EXISTS(SELECT 1 FROM subscription_tier_changes c JOIN subscription_periods p ON p.id=c.period_id WHERE c.order_id=o.id AND c.period_id=o.target_period_id AND p.user_id=o.user_id AND c.charged_fen=o.amount_fen)
 ELSE 0 END`;
 return {sql:`SELECT o.id order_id,o.user_id buyer_id,${credit?"'recharge'":"o.kind"} order_kind,o.status order_status,o.paid_at,o.${credit?'credited_at':'applied_at'} applied_at,
 b.status payment_status,b.paid_at bolt_paid_at,b.applied_at bolt_applied_at,b.base_amount_fen principal_fen,b.cny_per_usdt_micros,b.quoted_usdt_micros,b.payable_usdt_micros,b.paid_usdt_micros,b.network,b.token_decimals,b.payable_token_raw,
 CASE WHEN b.tx_hash IS NOT NULL AND length(b.tx_hash)>0 AND b.receiving_address IS NOT NULL AND length(b.receiving_address)>0 THEN 1 ELSE 0 END identity_present,
 CASE WHEN b.user_id=o.user_id AND b.product_type='${credit?'credits':'subscription'}' AND ${credit?"o.payment_method='boltutil' AND o.provider_reference=b.external_order_id":"b.base_amount_fen=o.amount_fen"} THEN 1 ELSE 0 END order_match,
 EXISTS(SELECT 1 FROM ${fiat} t WHERE t.order_id=o.id) fiat_conflict,
 (SELECT COUNT(*) FROM boltutil_orders x WHERE x.network=b.network AND x.tx_hash=b.tx_hash) identity_count,
 EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.network=b.network AND e.tx_hash=b.tx_hash AND e.external_order_id=b.external_order_id AND e.status IN ('CONFIRMED','COMPLETED') AND length(e.body_sha256)=64) payment_proof,
 ${applied} applied_proof
 FROM ${table} o JOIN boltutil_orders b ON b.${link}=o.id WHERE o.id=? LIMIT 2`,params:[orderId]};
}
export function classifyBoltCommissionEvidence(domain,rows){
 const blocked=reason=>({eligible:false,reason});
 if(!Array.isArray(rows)||rows.length!==1)return blocked('bolt_missing_or_ambiguous');
 const r=rows[0];
 if(r.order_status!=='paid'||r.payment_status!=='paid')return blocked('bolt_not_paid');
 if(r.order_match!==1||r.fiat_conflict!==0||r.identity_present!==1||r.identity_count!==1)return blocked('bolt_identity_review');
 if(r.payment_proof!==1||r.applied_proof!==1||!int(r.paid_at)||!int(r.applied_at,r.paid_at)||r.bolt_paid_at!==r.paid_at||!int(r.bolt_applied_at,r.applied_at))return blocked('bolt_missing_settlement_proof');
 if(!networks.has(r.network)||r.token_decimals!==(r.network==='BEP20'?18:6))return blocked('bolt_network_review');
 if(!int(r.principal_fen,1,1000000000000)||!int(r.cny_per_usdt_micros,100000,999999999)||!int(r.quoted_usdt_micros,1000000)||!int(r.payable_usdt_micros,r.quoted_usdt_micros)||r.paid_usdt_micros!==r.payable_usdt_micros)return blocked('bolt_invalid_amount_snapshot');
 const rate=BigInt(r.cny_per_usdt_micros);
 // Same ceiling arithmetic as quoteFromCnyFen in the payment contract.
 if((BigInt(r.principal_fen)*10000000000n+rate-1n)/rate!==BigInt(r.quoted_usdt_micros)||typeof r.payable_token_raw!=='string'||r.payable_token_raw!==(BigInt(r.payable_usdt_micros)*10n**BigInt(r.token_decimals-6)).toString())return blocked('bolt_invalid_amount_snapshot');
 if(domain==='subscription'&&!['purchase','renewal','upgrade'].includes(r.order_kind))return blocked('bolt_invalid_subscription');
 return {eligible:true,reason:'candidate_only',principalFen:r.principal_fen,refundedPrincipalFen:0,provider:'boltutil'};
}
