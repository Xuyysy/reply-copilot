import test from "node:test";
import assert from "node:assert/strict";
import { canRefreshPaymentOrder, refreshPaymentOrder } from "../src/lib/payment-refresh.mjs";

test("only unresolved Xiaodou awaiting-payment orders expose the provider refresh action", () => {
  const order = { provider: "xiaodou", status: "awaiting_payment", payment_status: "unknown" };
  assert.equal(canRefreshPaymentOrder(order), true);
  assert.equal(canRefreshPaymentOrder({ ...order, payment_status: "pending" }), true);
  assert.equal(canRefreshPaymentOrder({ ...order, payment_status: "paid" }), false);
  assert.equal(canRefreshPaymentOrder({ ...order, status: "paid" }), false);
  assert.equal(canRefreshPaymentOrder({ ...order, provider: "local_mock" }), false);
  assert.equal(canRefreshPaymentOrder({ ...order, provider: "mk99" }), true);
  assert.equal(canRefreshPaymentOrder(null), false);
});

test("refresh action submits one provider query and reloads account data after success", async () => {
  const inFlight = new Set();
  const calls = [];
  let reloads = 0;
  const request = async (...args) => { calls.push(args); return { ok: true, orderStatus: "unknown" }; };
  const result = await refreshPaymentOrder("7fdc3d09-a7b1-47c5-97dd-827d5ad0b178", { inFlight, request, reload: async () => { reloads++; } });
  assert.deepEqual(result, { ok: true, orderStatus: "unknown" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ["/v1/orders/7fdc3d09-a7b1-47c5-97dd-827d5ad0b178/refresh", { method: "POST", body: "{}" }]);
  assert.equal(reloads, 1);
  assert.equal(inFlight.size, 0);
});

test("refresh action prevents duplicate submission while a query is pending", async () => {
  const inFlight = new Set();
  let release;
  let calls = 0;
  const request = async () => { calls++; await new Promise(resolve => { release = resolve; }); return { ok: true }; };
  const options = { inFlight, request, reload: async () => {} };
  const first = refreshPaymentOrder("order-id", options);
  const duplicate = await refreshPaymentOrder("order-id", options);
  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, { ok: true });
  assert.equal(inFlight.size, 0);
});

test("refresh failure remains an error and does not reload or disguise payment status", async () => {
  const inFlight = new Set();
  let reloads = 0;
  const failure = Object.assign(new Error("查单结果已收到，但本地订单状态同步失败"), {
    code: "ORDER_RECONCILIATION_ERROR", requestId: "safe-request-id", diagnostic: { stage: "order_reconciliation", upstreamHttpStatus: 200 },
  });
  await assert.rejects(refreshPaymentOrder("order-id", { inFlight, request: async () => { throw failure; }, reload: async () => { reloads++; } }), error => error === failure);
  assert.equal(reloads, 0);
  assert.equal(inFlight.size, 0);
});
