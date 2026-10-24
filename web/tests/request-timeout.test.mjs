import test from "node:test";
import assert from "node:assert/strict";
import { withRequestTimeout } from "../src/lib/request-timeout.mjs";

test("account API operation is bounded and aborts its underlying request", async () => {
  let observedSignal;
  await assert.rejects(
    withRequestTimeout((signal) => {
      observedSignal = signal;
      return new Promise(() => {});
    }, 15),
    (error) => error?.name === "RequestTimeoutError",
  );
  assert.equal(observedSignal?.aborted, true);
});

test("request timeout helper preserves successful results and caller cancellation", async () => {
  assert.equal(await withRequestTimeout(async () => "ok", 100), "ok");

  const controller = new AbortController();
  const pending = withRequestTimeout((signal) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  }), 1000, controller.signal);
  controller.abort();
  await assert.rejects(pending, (error) => error?.name === "AbortError");
});
