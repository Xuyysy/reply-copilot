// Local checkout abandonment is NOT a provider close or a payment verdict.
// A late authenticated payment event must still be able to settle this order.
// This is intentionally restricted to first-attempt, linkless purchases; never
// auto-release an order whose cashier or provider payment identity was issued.
const paymentProviders = {
  mk99: {
    protocol: 'rsa2', // historical MK99 credit-pack transaction snapshot
    markerSql: "a.state='unknown' AND a.provider_code GLOB 'unknown:MK99_*'",
  },
  xiaodou: {
    protocol: 'rsa2',
    markerSql: "((a.state='unknown' AND a.provider_code GLOB 'checkout-v2:unknown:*') OR (a.state='failed' AND a.provider_code GLOB 'checkout-v2:rejected:*') OR (a.state IN ('pending','unknown') AND a.provider_code IN ('checkout-v2:unavailable:CHECKOUT_LINK_MISSING','checkout-v2:unavailable:CHECKOUT_FEE_PROJECTION_REVIEW','checkout-v2:unavailable:CHECKOUT_NOT_PAYABLE'))) ",
  },
};

/**
 * Release a locally unusable *credit pack* attempt to allow another checkout.
 * No provider calls, no new order, no money/credit changes, and no rewriting
 * payment_transactions: signed notifications may still settle a late payment.
 * For immediate post-create release pass orderId; for stale blocked checkout
 * discovery pass packageId. Both scopes always constrain the same user.
 */
/** @param {any} env @param {{userId:string,merchant:'mk99'|'xiaodou',orderId?:string,packageId?:string}} options */
export async function releaseUnusableCreditCheckout(env, { userId, merchant, orderId, packageId }) {
  const rule = paymentProviders[merchant];
  if (!rule || typeof userId !== 'string' || userId.length<1 || userId.length>128) throw new Error('INVALID_RETRY_RELEASE_SCOPE');
  const byOrder = orderId !== undefined;
  if (byOrder === (packageId !== undefined)) throw new Error('INVALID_RETRY_RELEASE_SCOPE');
  if (byOrder && (typeof orderId !== 'string' || !/^[0-9a-f-]{36}$/i.test(orderId))) throw new Error('INVALID_RETRY_RELEASE_SCOPE');
  if (!byOrder && (typeof packageId !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(packageId))) throw new Error('INVALID_RETRY_RELEASE_SCOPE');
  const scope = byOrder ? 'o.id=? AND o.user_id=?' : 'o.user_id=? AND o.package_id=?';
  const params = byOrder ? [orderId, userId] : [userId, packageId];
  const query = `UPDATE recharge_orders SET status='expired' WHERE id IN (
    SELECT o.id FROM recharge_orders o
    JOIN payment_transactions t ON t.order_id=o.id
    JOIN payment_attempts a ON a.transaction_id=t.id AND a.attempt_number=1
    WHERE ${scope}
      AND o.status='awaiting_payment' AND o.paid_at IS NULL AND o.credited_at IS NULL
      AND t.merchant_provider=? AND t.payment_protocol=?
      AND t.status IN ('unknown','pending') AND t.risk_state='clear'
      AND t.provider_payment_id IS NULL AND t.paid_at IS NULL
      AND COALESCE(t.actual_paid_fen,0)=0
      AND (t.cashier_url IS NULL OR t.cashier_url='')
      AND (a.cashier_url IS NULL OR a.cashier_url='')
      AND ${rule.markerSql}
      AND NOT EXISTS (SELECT 1 FROM payment_attempts a2 WHERE a2.transaction_id=t.id AND a2.id<>a.id)
      AND NOT EXISTS (SELECT 1 FROM provider_payment_events e WHERE e.transaction_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM payment_refunds r WHERE r.transaction_id=t.id)
      AND NOT EXISTS (SELECT 1 FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id)
      AND NOT EXISTS (SELECT 1 FROM credit_batches b WHERE b.source_order_id=o.id)
      AND (SELECT count(*) FROM payment_transactions t2 WHERE t2.order_id=o.id)=1
  )`;
  const result = await env.DB.prepare(query).bind(...params, merchant, rule.protocol).run();
  const released = Number(result.meta?.changes ?? 0);
  if (released > 0) console.info({ event: 'credit_checkout_retry_released', merchant, count: released });
  return released > 0;
}
