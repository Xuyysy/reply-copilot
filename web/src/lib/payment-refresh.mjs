/**
 * Runs one owner-initiated provider status refresh for an order.
 * The lock is shared with the component so rapid clicks cannot duplicate it.
 */
export function canRefreshPaymentOrder(order) {
  return ["xiaodou","mk99"].includes(order?.provider)
    && order.status === "awaiting_payment"
    && (order.payment_status === "unknown" || order.payment_status === "pending");
}

export async function refreshPaymentOrder(orderId, { inFlight, request, reload }) {
  if (inFlight.has(orderId)) return false;
  inFlight.add(orderId);
  try {
    const result = await request(`/v1/orders/${encodeURIComponent(orderId)}/refresh`, { method: "POST", body: "{}" });
    await reload();
    return result;
  } finally {
    inFlight.delete(orderId);
  }
}
