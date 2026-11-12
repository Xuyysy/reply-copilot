// Never relabel ambiguous subscription money as failed or closed.
// A first attempt with no cashier, provider identity, risk or settlement may
// stop blocking *new* checkout, retaining original UNKNOWN order for late
// authenticated query/webhook reconciliation.
const aliases=new Set(['o','x']);
export function subscriptionRetryableSql(alias){
 if(!aliases.has(alias))throw new Error('INVALID_SUBSCRIPTION_RETRY_SQL_ALIAS');
 return `(${alias}.status='unknown'
    AND ${alias}.paid_at IS NULL AND ${alias}.applied_at IS NULL
    AND EXISTS (SELECT 1 FROM subscription_payment_transactions rt
      WHERE rt.order_id=${alias}.id AND rt.merchant_provider IN ('mk99','xiaodou')
        AND rt.status='unknown' AND rt.checkout_state='unknown'
        AND rt.checkout_attempted_at IS NOT NULL AND rt.cashier_ready_at IS NULL
        AND rt.risk_state='clear' AND rt.paid_at IS NULL
        AND rt.provider_payment_id IS NULL
        AND (rt.cashier_url IS NULL OR rt.cashier_url='')
        AND NOT EXISTS (SELECT 1 FROM subscription_payment_events ev WHERE ev.transaction_id=rt.id))
    AND NOT EXISTS (SELECT 1 FROM subscription_periods p WHERE p.source_order_id=${alias}.id)
    AND NOT EXISTS (SELECT 1 FROM subscription_tier_changes c WHERE c.order_id=${alias}.id))`;
}
export function subscriptionBlocksNewCheckoutSql(alias){
 if(!aliases.has(alias))throw new Error('INVALID_SUBSCRIPTION_RETRY_SQL_ALIAS');
 return `(${alias}.status IN ('pending','unknown','manual_review','refund_pending') AND NOT ${subscriptionRetryableSql(alias)})`;
}
