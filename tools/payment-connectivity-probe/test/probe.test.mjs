import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest, runProbe } from "../src/index.js";

const BASE = "https://merchant.invalid";

function fetchQueue(...items) {
  const calls = [];
  return {
    calls,
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      const next = items.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next(init);
      return next;
    },
  };
}

function response(status, headers = {}) {
  return new Response(null, { status, headers });
}

test("public HTTPS 200 is reported as an HTTP response without credentials", async () => {
  const queue = fetchQueue(response(200));
  const result = await runProbe({ test: "public_https", target: "https://example.com/", fetcher: queue.fetcher });
  assert.equal(result.outcome, "http_response");
  assert.equal(result.httpStatus, 200);
  assert.equal(queue.calls.length, 1);
  assert.equal(queue.calls[0].url, "https://example.com/");
  assert.equal(queue.calls[0].init.method, "GET");
  assert.equal(queue.calls[0].init.redirect, "manual");
  assert.equal(queue.calls[0].init.headers, undefined);
  assert.equal(queue.calls[0].init.body, undefined);
});

test("a provider root 404 still counts as an HTTP response", async () => {
  const queue = fetchQueue(response(404));
  const result = await runProbe({ test: "xiaodou_base", target: BASE, fetcher: queue.fetcher });
  assert.equal(result.outcome, "http_response");
  assert.equal(result.httpStatus, 404);
});

test("a provider root 403 still counts as an HTTP response", async () => {
  const result = await runProbe({ test: "xiaodou_base", target: BASE, fetcher: async () => response(403) });
  assert.equal(result.outcome, "http_response");
  assert.equal(result.httpStatus, 403);
});

test("fetch TypeError is classified without guessing DNS or TLS", async () => {
  const result = await runProbe({ test: "public_https", target: "https://example.com/", fetcher: async () => { throw new TypeError("secret URL detail"); } });
  assert.equal(result.outcome, "fetch_rejected");
  assert.equal(result.errorCategory, "fetch_rejected");
});

test("an aborted request is classified as a timeout", async () => {
  const fetcher = async (_url, init) => await new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true });
  });
  const result = await runProbe({ test: "public_https", target: "https://example.com/", fetcher, timeoutMs: 5 });
  assert.equal(result.outcome, "timeout");
  assert.equal(result.errorCategory, "timeout");
});

test("non-HTTPS targets are rejected before fetch", async () => {
  const queue = fetchQueue(response(200));
  const result = await runProbe({ test: "xiaodou_base", target: "http://merchant.invalid", fetcher: queue.fetcher });
  assert.equal(result.outcome, "configuration_error");
  assert.equal(result.httpStatus, null);
  assert.equal(queue.calls.length, 0);
});

test("redirects are not followed and are marked rejected", async () => {
  const queue = fetchQueue(response(302, { location: "https://other.invalid/" }), response(200));
  const result = await runProbe({ test: "xiaodou_base", target: BASE, fetcher: queue.fetcher });
  assert.equal(result.outcome, "http_response");
  assert.equal(result.httpStatus, 302);
  assert.equal(result.errorCategory, "redirect_rejected");
  assert.equal(queue.calls.length, 1);
});

test("missing provider configuration is reported without a request", async () => {
  const queue = fetchQueue(response(200));
  const result = await handleRequest(new Request("https://probe.invalid/run", { method: "POST", headers: { authorization: "Bearer test-trigger-token-0123456789abcdef" } }), {
    ENVIRONMENT: "staging", PROBE_ENABLED: "1", PROBE_TRIGGER_TOKEN: "test-trigger-token-0123456789abcdef", XIAODOU_PROBE_BASE_URL: "",
  }, { fetcher: queue.fetcher });
  assert.equal(result.status, 200);
  const body = await result.json();
  assert.equal(body.results.public_https.outcome, "http_response");
  assert.equal(body.results.xiaodou_base.outcome, "configuration_error");
  assert.equal(queue.calls.length, 1);
});

test("invalid provider URLs never reach fetch", async () => {
  const queue = fetchQueue(response(200));
  const result = await runProbe({ test: "xiaodou_base", target: "not a URL", fetcher: queue.fetcher });
  assert.equal(result.outcome, "configuration_error");
  assert.equal(queue.calls.length, 0);
});

test("provider target rejects path prefixes, query, fragment, credentials, and nonstandard ports", async () => {
  for (const target of [
    "https://merchant.invalid/api/open/v1",
    "https://merchant.invalid/?debug=1",
    "https://merchant.invalid/#fragment",
    "https://user:password@merchant.invalid/",
    "https://merchant.invalid:8443/",
  ]) {
    const queue = fetchQueue(response(200));
    const result = await runProbe({ test: "xiaodou_base", target, fetcher: queue.fetcher });
    assert.equal(result.outcome, "configuration_error");
    assert.equal(queue.calls.length, 0);
  }
});

test("public requests cannot choose the probe target", async () => {
  const queue = fetchQueue(response(200));
  const result = await handleRequest(new Request("https://probe.invalid/run?url=https://attacker.invalid", { method: "POST", headers: { authorization: "Bearer test-trigger-token-0123456789abcdef" } }), {
    ENVIRONMENT: "staging", PROBE_ENABLED: "1", PROBE_TRIGGER_TOKEN: "test-trigger-token-0123456789abcdef", XIAODOU_PROBE_BASE_URL: BASE,
  }, { fetcher: queue.fetcher });
  assert.equal(result.status, 404);
  assert.equal(queue.calls.length, 0);
});

test("unauthorized requests cannot start either probe", async () => {
  const queue = fetchQueue(response(200));
  const result = await handleRequest(new Request("https://probe.invalid/run", { method: "POST" }), {
    ENVIRONMENT: "staging", PROBE_ENABLED: "1", PROBE_TRIGGER_TOKEN: "test-trigger-token-0123456789abcdef", XIAODOU_PROBE_BASE_URL: BASE,
  }, { fetcher: queue.fetcher });
  assert.equal(result.status, 401);
  assert.equal(queue.calls.length, 0);
});

test("response and logs do not expose probe addresses or secrets", async () => {
  const queue = fetchQueue(response(200), response(404));
  const previousLog = console.log;
  const logged = [];
  console.log = (...values) => logged.push(values);
  try {
    const result = await handleRequest(new Request("https://probe.invalid/run", { method: "POST", headers: { authorization: "Bearer test-trigger-token-0123456789abcdef" } }), {
      ENVIRONMENT: "staging", PROBE_ENABLED: "1", PROBE_TRIGGER_TOKEN: "test-trigger-token-0123456789abcdef", XIAODOU_PROBE_BASE_URL: BASE,
    }, { fetcher: queue.fetcher });
    const text = await result.text();
    assert.doesNotMatch(text, /merchant\.invalid|test-trigger-token-0123456789abcdef|example\.com/);
    assert.doesNotMatch(JSON.stringify(logged), /merchant\.invalid|test-trigger-token-0123456789abcdef|example\.com/);
  } finally { console.log = previousLog; }
});

test("diagnostic trigger is disabled outside enabled Staging", async () => {
  const queue = fetchQueue(response(200));
  const request = new Request("https://probe.invalid/run", { method: "POST", headers: { authorization: "Bearer test-trigger-token-0123456789abcdef" } });
  const off = await handleRequest(request, { ENVIRONMENT: "staging", PROBE_ENABLED: "0", PROBE_TRIGGER_TOKEN: "test-trigger-token-0123456789abcdef" }, { fetcher: queue.fetcher });
  assert.equal(off.status, 404);
  const wrongEnv = await handleRequest(request, { ENVIRONMENT: "production", PROBE_ENABLED: "1", PROBE_TRIGGER_TOKEN: "test-trigger-token-0123456789abcdef" }, { fetcher: queue.fetcher });
  assert.equal(wrongEnv.status, 404);
  assert.equal(queue.calls.length, 0);
});
