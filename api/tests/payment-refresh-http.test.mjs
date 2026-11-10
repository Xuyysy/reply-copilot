import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-payment-refresh-"));
const bundlePath = path.join(temp, "worker.cjs");
buildSync({ entryPoints: [path.join(apiRoot, "src/index.ts")], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: bundlePath });
const loaded = await import(pathToFileURL(bundlePath));
const worker = loaded.default?.default || loaded.default;
const merchant = generateKeyPairSync("rsa", { modulusLength: 2048 });
const platform = generateKeyPairSync("rsa", { modulusLength: 2048 });
const merchantPrivateKey = merchant.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const platformPublicKey = platform.publicKey.export({ type: "spki", format: "pem" }).toString();
const sessionToken = "a".repeat(64);
const authSecret = "payment-refresh-test-auth-secret-long-enough";
const webOrigin = "https://staging.x-reply-helper.top";
const orderId = "11111111-1111-4111-8111-111111111111";
const transaction = {
  id: "22222222-2222-4222-8222-222222222222", order_id: orderId, provider: "xiaodou", amount_fen: 1006,
  currency: "CNY", status: "unknown", provider_trade_id: "XRH_22222222222242228222222222222222",
  order_user_id: "owner-user", order_credits: 400, order_status: "awaiting_payment", credited_at: null,
  base_amount_fen: 990, service_fee_fen: 16, fee_rate_bps: 150,
  provider_fee_projection_status: "pending", provider_fee_projection_json: null, provider_fee_projection_issue: null,
};
const feeProjection = { ruleVersion: "2026-10", thresholdFen: 0, tier: "STANDARD", merchantRateBps: 250,
  companyServiceFeeRateBps: 100, merchantSettlementFen: 976, companyServiceFeeFen: 30 };

function makeDb() {
  const state = { transaction: { ...transaction }, sessionUser: "owner-user", freeBalance: 200, paidBalance: 0, events: new Map(), writes: 0, batchCalls: 0, attempts: 0, failProjectionWrite: false };
  return {
    state,
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM sessions JOIN users")) return { id: "session-1", user_id: state.sessionUser, kind: "web", expires_at: Date.now() + 60_000 };
          if (sql.includes("FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE o.id=? AND o.user_id=?")) {
            return this.args[1] === state.transaction.order_user_id ? { ...state.transaction } : null;
          }
          if (sql.includes("FROM payment_transactions t JOIN recharge_orders o ON o.id=t.order_id WHERE t.order_id=?")) return { ...state.transaction };
          if (sql.includes("FROM provider_payment_events WHERE provider=? AND provider_event_id=?")) {
            const event = state.events.get(`${this.args[0]}:${this.args[1]}`);
            return event ? { ...event } : null;
          }
          if (sql.includes("MAX(0,free_balance-free_generation_reserved)")) return { free_remaining: state.freeBalance, paid_remaining: state.paidBalance };
          return null;
        },
        async run() {
          state.writes++;
          if (sql.includes("UPDATE payment_transactions SET provider_fee_projection_status=?")) {
            if (state.failProjectionWrite) throw new Error("internal-db-failure-marker");
            Object.assign(state.transaction, { provider_fee_projection_status: this.args[0], provider_fee_projection_json: this.args[1], provider_fee_projection_issue: this.args[2] });
          }
          if (sql.includes("INSERT INTO payment_attempts")) state.attempts++;
          return { meta: { changes: 1 } };
        },
        async all() {
          if (sql.includes("FROM credit_ledger")) return { results: [] };
          if (sql.includes("FROM recharge_orders o LEFT JOIN payment_transactions")) return { results: [{
            id: orderId, package_name: "400 次", credits: 400, status: "awaiting_payment", provider: "xiaodou", payment_status: "unknown",
            refund_eligibility: "not_paid", created_at: Date.now(), base_amount_fen: 990, service_fee_fen: 16, total_amount_fen: 1006,
          }] };
          return { results: [] };
        },
      };
    },
    async batch(statements) {
      state.batchCalls++;
      const eventArgs = statements[0].args;
      state.events.set(`${eventArgs[1]}:${eventArgs[2]}`, { transaction_id: eventArgs[3], event_type: eventArgs[4], amount_fen: eventArgs[5], currency: eventArgs[6] });
      state.transaction.status = "paid";
      state.transaction.order_status = "paid";
      state.transaction.credited_at ??= Date.now();
      state.paidBalance += state.transaction.order_credits;
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}

function env(DB, environment = "staging") {
  return {
    ENVIRONMENT: environment, WEB_ORIGIN: webOrigin, API_ORIGIN: "https://api-staging.x-reply-helper.top",
    EXTENSION_ORIGIN: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", PAYMENT_PROVIDER: "xiaodou",
    PAYMENTS_ENABLED: "0", XIAODOU_WEBHOOKS_ENABLED: "1", XIAODOU_BASE_URL: "https://merchant.example.test",
    XIAODOU_APP_ID: "xdop_1234567890abcdef", XIAODOU_KEY_ID: "mkid_0123456789abcdef",
    XIAODOU_PRIVATE_KEY: merchantPrivateKey, XIAODOU_PLATFORM_PUBLIC_KEYS: JSON.stringify({ "platform-test-key": platformPublicKey }),
    AUTH_HASH_SECRET: authSecret, DB, SITE_DAILY_CAP: "10", AI_MODE: "mock",
  };
}

async function csrfToken() {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`csrf:${sessionToken}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedProviderResponse(request, { status = "SUCCEEDED", amountFen = 1006, outTradeNo = transaction.provider_trade_id, invalidSignature = false, httpStatus = 200, errorCode, errorDetails } = {}) {
  const requestId = request.headers.get("X-XD-Request-Id");
  const payload = JSON.stringify(errorCode ? { code: errorCode, message: "private-upstream-message", requestId,
    ...(errorDetails !== undefined ? { details: errorDetails } : {}) } : { outTradeNo, amountFen, currency: "CNY", status, feeProjection });
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = "provider-nonce-1234", keyId = "platform-test-key";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonical = ["XD-Response-v1", String(httpStatus), "application/json", requestId, timestamp, nonce, keyId, hex].join("\n");
  const signature = sign("RSA-SHA256", Buffer.from(canonical), platform.privateKey).toString("base64");
  return new Response(payload, { status: httpStatus, headers: {
    "Content-Type": "application/json", "X-XD-Response-Sign": invalidSignature ? `${signature.slice(1)}A` : signature, "X-XD-Response-Key-Id": keyId,
    "X-XD-Response-Timestamp": timestamp, "X-XD-Response-Nonce": nonce, "X-XD-Request-Id": requestId,
  } });
}

async function call(path, DB, { userId = "owner-user", method = "POST", body, environment = "staging", envOverrides = {}, authenticated = true, csrfValid = true, query = async (request) => signedProviderResponse(request) } = {}) {
  const csrf = await csrfToken();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => query(new Request(url, init));
  try {
    const request = new Request(`https://api-staging.x-reply-helper.top${path}`, {
      method, headers: { Origin: webOrigin, "CF-Connecting-IP": "8.8.8.8", ...(authenticated ? { Cookie: `rc_session=${sessionToken}` } : {}),
        ...(method === "POST" ? { "X-CSRF-Token": csrfValid ? csrf : "invalid-csrf", "X-Reply-Copilot-Action": "1", "Content-Type": "application/json", ...(body ? {} : {}) } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    DB.state.sessionUser = userId;
    const response = await worker.fetch(request, { ...env(DB, environment), ...envOverrides });
    return { response, body: await response.json() };
  } finally { globalThis.fetch = originalFetch; }
}

test.after(() => rmSync(temp, { recursive: true, force: true }));

test("payments off blocks new orders and payment attempts but allows owned order reads", async () => {
  const DB = makeDb();
  const create = await call("/v1/orders", DB, { body: { packageId: "starter" } });
  assert.equal(create.response.status, 503);
  assert.equal(create.body.code, "PAYMENT_UNAVAILABLE");
  assert.equal(DB.state.writes, 0, "rejected checkout must not create an order or payment attempt");
  const refresh = await call(`/v1/orders/${orderId}/refresh`, DB);
  assert.equal(refresh.response.status, 200, JSON.stringify(refresh.body));
  assert.equal(refresh.body.orderStatus, "paid");
  const relaunch = await call(`/v1/orders/${orderId}/attempts`, DB);
  assert.equal(relaunch.response.status, 409);
  assert.equal(DB.state.attempts, 0, "closed payment setting must not create a new attempt");
  assert.equal(DB.state.paidBalance, 400);
});

test("activity exposes provider and payment state needed for the account refresh action", async () => {
  const DB = makeDb();
  const result = await call("/v1/activity", DB, { method: "GET" });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.orders[0].status, "awaiting_payment");
  assert.equal(result.body.orders[0].provider, "xiaodou");
  assert.equal(result.body.orders[0].payment_status, "unknown");
});

test("payments-off refresh enforces ownership and does not call provider for another user's order", async () => {
  const DB = makeDb(); let providerCalls = 0;
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { userId: "other-user", query: async () => { providerCalls++; return new Response(); } });
  assert.equal(result.response.status, 404);
  assert.equal(result.body.code, "ORDER_NOT_FOUND");
  assert.equal(providerCalls, 0);
  assert.equal(DB.state.writes, 0);
});

test("fetch failure is returned as a safe provider network diagnostic and never marks paid", async () => {
  const DB = makeDb();
  let upstreamRequestId;
  const failed = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async (request) => { upstreamRequestId = request.headers.get("X-XD-Request-Id"); throw new Error("offline https://merchant.example.test/private-path key=do-not-leak"); } });
  assert.equal(failed.response.status, 503);
  assert.equal(failed.body.code, "PROVIDER_NETWORK_ERROR");
  assert.deepEqual(failed.body.diagnostic, { stage: "provider_fetch", upstreamHttpStatus: null });
  assert.equal(failed.body.requestId, upstreamRequestId);
  assert.doesNotMatch(JSON.stringify(failed.body), /merchant\.example\.test|private-path|do-not-leak|offline/);
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.paidBalance, 0);
  assert.equal(DB.state.batchCalls, 0);
});

test("provider HTTP errors expose only status and safe category", async () => {
  const DB = makeDb();
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async () => new Response(JSON.stringify({ code: "PRIVATE_PLATFORM_DETAIL", message: "do-not-leak" }), { status: 503 }) });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, "PROVIDER_HTTP_ERROR");
  assert.deepEqual(result.body.diagnostic, { stage: "provider_http_response", upstreamHttpStatus: 503,
    providerResponse: { format: "other_json", providerCode: null, signatureState: "absent", sourceIpReason: null } });
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_PLATFORM_DETAIL|do-not-leak/);
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.paidBalance, 0);
  assert.equal(DB.state.batchCalls, 0);
});

test("provider response signature failures get a safe classification", async () => {
  const DB = makeDb();
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async (request) => signedProviderResponse(request, { invalidSignature: true }) });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, "PROVIDER_SIGNATURE_ERROR");
  assert.deepEqual(result.body.diagnostic, { stage: "provider_response_signature", upstreamHttpStatus: 200,
    providerResponse: { format: "other_json", providerCode: null, signatureState: "invalid", sourceIpReason: null } });
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.paidBalance, 0);
  assert.equal(DB.state.batchCalls, 0);
});

test("incomplete provider response signature is classified as a signature failure", async () => {
  const DB = makeDb();
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async (request) => {
    const signed = await signedProviderResponse(request);
    const headers = new Headers(signed.headers);
    headers.delete("X-XD-Response-Nonce");
    return new Response(await signed.text(), { status: signed.status, headers });
  } });
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, "PROVIDER_SIGNATURE_ERROR");
  assert.deepEqual(result.body.diagnostic, { stage: "provider_response_signature", upstreamHttpStatus: 200,
    providerResponse: { format: "other_json", providerCode: null, signatureState: "incomplete", sourceIpReason: null } });
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.paidBalance, 0);
  assert.equal(DB.state.batchCalls, 0);
});

test("missing provider configuration is classified safely in Staging", async () => {
  const DB = makeDb();
  let providerCalls = 0;
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { envOverrides: { XIAODOU_BASE_URL: "" }, query: async () => { providerCalls++; return new Response(); } });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "PROVIDER_CONFIG_ERROR");
  assert.deepEqual(result.body.diagnostic, { stage: "provider_config", upstreamHttpStatus: null });
  assert.equal(providerCalls, 0);
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.writes, 0);
});

test("local reconciliation failures are classified without exposing exception detail", async () => {
  const DB = makeDb();
  DB.state.failProjectionWrite = true;
  const result = await call(`/v1/orders/${orderId}/refresh`, DB);
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "ORDER_RECONCILIATION_ERROR");
  assert.deepEqual(result.body.diagnostic, { stage: "order_reconciliation", upstreamHttpStatus: 200 });
  assert.doesNotMatch(JSON.stringify(result.body), /internal-db-failure-marker/);
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.paidBalance, 0);
  assert.equal(DB.state.batchCalls, 0);
});

test("production refresh errors keep generic response details", async () => {
  const DB = makeDb();
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { environment: "production", query: async () => { throw new Error("private-provider-error"); } });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "SERVER_UNAVAILABLE");
  assert.equal(result.body.diagnostic, undefined);
  assert.doesNotMatch(JSON.stringify(result.body), /private-provider-error|merchant\.example\.test/);
});

test("repeated trusted queries are idempotent; provider failures never mark paid", async () => {
  const DB = makeDb();
  const first = await call(`/v1/orders/${orderId}/refresh`, DB);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.orderStatus, "paid");
  assert.equal(first.body.quota.paidRemaining, 400);
  const second = await call(`/v1/orders/${orderId}/refresh`, DB);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.quota.paidRemaining, 400);
  assert.equal(DB.state.batchCalls, 1, "the same paid order is granted once across repeated trusted queries");
  assert.equal(DB.state.paidBalance, 400);
  assert.equal(DB.state.events.size, 1);
  assert.equal(DB.state.attempts, 0);
});

test("HTTP error provenance survives the entire authenticated refresh chain without writes", async (t) => {
  const missing = "OPEN_API_RESOURCE_NOT_FOUND";
  const cases = [
    { name: "signed business 404", status: 404, code: missing, signature: "verified", format: "business_json", signed: true },
    { name: "unsigned business 404", status: 404, code: missing, signature: "absent", format: "business_json" },
    { name: "gateway HTML 404", status: 404, code: null, signature: "absent", format: "html", body: "<html>private-gateway-message</html>", contentType: "text/html" },
    { name: "invalid signed business 404", status: 404, code: missing, signature: "invalid", format: "business_json", signed: true, invalid: true },
    { name: "incomplete signature 404", status: 404, code: missing, signature: "incomplete", format: "business_json", signed: true, incomplete: true },
    { name: "pre-auth unsigned 401", status: 401, code: "OPEN_API_SIGNATURE_INVALID", signature: "absent", format: "business_json" },
    { name: "signed channel error 422", status: 422, code: "OPEN_API_CHANNEL_UNAVAILABLE", signature: "verified", format: "business_json", signed: true },
    { name: "signed guard error 503", status: 503, code: "OPEN_API_GUARD_UNAVAILABLE", signature: "verified", format: "business_json", signed: true },
    { name: "unknown code redacted even if signed", status: 404, code: null, suppliedCode: "PRIVATE_PLATFORM_DETAIL", signature: "verified", format: "business_json", signed: true },
    { name: "non-business JSON", status: 404, code: null, signature: "absent", format: "other_json", body: '{"code":"OPEN_API_RESOURCE_NOT_FOUND"}' },
    { name: "invalid JSON", status: 404, code: null, signature: "absent", format: "other", body: "private-invalid-json" },
    { name: "empty signature header still fails closed", status: 404, code: missing, signature: "invalid", format: "business_json", signed: true, empty: true },
    { name: "stale complete signature still fails closed", status: 404, code: missing, signature: "invalid", format: "business_json", signed: true, stale: true },
    { name: "response request ID mismatch still fails closed", status: 404, code: missing, signature: "invalid", format: "business_json", signed: true, wrongId: true },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const DB = makeDb(); let upstreamId;
    const result = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async (request) => {
      upstreamId = request.headers.get("X-XD-Request-Id");
      if (c.signed) {
        const response = await signedProviderResponse(request, { httpStatus: c.status, errorCode: c.suppliedCode || c.code, invalidSignature: c.invalid });
        const headers = new Headers(response.headers);
        if (c.incomplete) headers.delete("X-XD-Response-Nonce");
        if (c.empty) headers.set("X-XD-Response-Sign", "");
        if (c.stale) headers.set("X-XD-Response-Timestamp", "1");
        if (c.wrongId) headers.set("X-XD-Request-Id", "wrong-request-12345678");
        return new Response(await response.text(), { status: c.status, headers });
      }
      return new Response(c.body ?? JSON.stringify({ code: c.code, message: "private-upstream-message", requestId: upstreamId }),
        { status: c.status, headers: { "Content-Type": c.contentType || "application/json" } });
    } });
    const signatureFailure = ["invalid", "incomplete"].includes(c.signature);
    assert.equal(result.response.status, 502);
    assert.equal(result.body.code, signatureFailure ? "PROVIDER_SIGNATURE_ERROR" : "PROVIDER_HTTP_ERROR");
    assert.equal(result.body.requestId, upstreamId);
    assert.deepEqual(result.body.diagnostic, {
      stage: signatureFailure ? "provider_response_signature" : "provider_http_response", upstreamHttpStatus: c.status,
      providerResponse: { format: c.format, providerCode: c.code, signatureState: c.signature, sourceIpReason: null },
    });
    assert.equal(DB.state.writes, 0);
    assert.equal(DB.state.batchCalls, 0);
    assert.equal(DB.state.events.size, 0);
    assert.equal(DB.state.attempts, 0);
    assert.deepEqual(DB.state.transaction, transaction);
    assert.equal(DB.state.freeBalance, 200);
    assert.equal(DB.state.paidBalance, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /private-|PRIVATE_PLATFORM_DETAIL|merchant\.example\.test|X-XD-Response|BEGIN .*KEY/);
  });
});

test("production does not expose signed HTTP error provenance", async () => {
  const DB = makeDb();
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { environment: "production",
    query: (request) => signedProviderResponse(request, { httpStatus: 404, errorCode: "OPEN_API_RESOURCE_NOT_FOUND" }) });
  assert.equal(result.response.status, 503);
  assert.equal(result.body.code, "SERVER_UNAVAILABLE");
  assert.equal(result.body.diagnostic, undefined);
  assert.doesNotMatch(JSON.stringify(result.body), /OPEN_API_|providerResponse|private-/);
  assert.equal(DB.state.writes, 0);
  assert.equal(DB.state.batchCalls, 0);
});

test("HTTP provenance is inaccessible without a session and valid CSRF", async () => {
  for (const options of [{authenticated:false}, {csrfValid:false}]) {
    const DB = makeDb(); let calls = 0;
    const result = await call(`/v1/orders/${orderId}/refresh`, DB, { ...options,
      query: async () => { calls++; throw new Error("must-not-call-provider"); } });
    assert.equal(result.response.status >= 400, true);
    assert.equal(result.body.diagnostic, undefined);
    assert.equal(calls, 0);
    assert.equal(DB.state.writes, 0);
    assert.equal(DB.state.batchCalls, 0);
  }
});

test("source-IP reasons are filtered and propagated without any payment writes", async (t) => {
  const sourceCode = "OPEN_API_SOURCE_IP_REJECTED";
  const reasons = ["PEER_NOT_TRUSTED", "FORWARDED_HEADER_PRESENT", "XFF_MISSING", "XFF_CHAIN_ABNORMAL",
    "XFF_LAST_INVALID", "REAL_IP_MISSING", "HEADER_CONFLICT"];
  const cases = [
    ...reasons.map(reason => ({ name: reason, details: { reason }, expected: reason })),
    { name: "no details", expected: null },
    { name: "no reason", details: {}, expected: null },
    { name: "unknown reason", details: { reason: "private-unknown-reason" }, expected: null },
    { name: "null details", details: null, expected: null },
    { name: "string details", details: "private-details", expected: null },
    { name: "array details", details: [{ reason: "PEER_NOT_TRUSTED" }], expected: null },
    { name: "number reason", details: { reason: 403 }, expected: null },
    { name: "array reason", details: { reason: ["PEER_NOT_TRUSTED"] }, expected: null },
    { name: "object reason", details: { reason: { value: "PEER_NOT_TRUSTED" } }, expected: null },
    { name: "nested reason", details: { nested: { reason: "PEER_NOT_TRUSTED" } }, expected: null },
    ...[401, 404, 422, 503].map(status => ({ name: `non-403 ${status}`, status, details: { reason: "PEER_NOT_TRUSTED" }, expected: null })),
    { name: "other provider code", code: "OPEN_API_RESOURCE_NOT_FOUND", details: { reason: "PEER_NOT_TRUSTED" }, expected: null },
    { name: "non-business JSON", body: '{"code":"OPEN_API_SOURCE_IP_REJECTED","details":{"reason":"PEER_NOT_TRUSTED"}}', format: "other_json", providerCode: null, expected: null },
    { name: "HTML response", body: '<html>private-gateway</html>', contentType: "text/html", format: "html", providerCode: null, expected: null },
    { name: "signed source error", signed: true, details: { reason: "PEER_NOT_TRUSTED", ip: "private-ip-marker" }, expected: "PEER_NOT_TRUSTED", signature: "verified" },
    { name: "bad signature stays closed", signed: true, invalid: true, details: { reason: "HEADER_CONFLICT" }, expected: "HEADER_CONFLICT", signature: "invalid" },
    { name: "partial signature stays closed", signed: true, incomplete: true, details: { reason: "XFF_MISSING" }, expected: "XFF_MISSING", signature: "incomplete" },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const DB = makeDb(); const status = c.status ?? 403, code = c.code ?? sourceCode;
    const result = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async (request) => {
      if (c.signed) {
        const response = await signedProviderResponse(request, { httpStatus: status, errorCode: code, errorDetails: c.details, invalidSignature: c.invalid });
        const headers = new Headers(response.headers);
        if (c.incomplete) headers.delete("X-XD-Response-Nonce");
        return new Response(await response.text(), { status, headers });
      }
      return new Response(c.body ?? JSON.stringify({ code, message: "private-upstream-message",
        requestId: request.headers.get("X-XD-Request-Id"), ...(c.details !== undefined ? { details: c.details } : {}) }),
        { status, headers: { "Content-Type": c.contentType ?? "application/json" } });
    } });
    assert.equal(result.response.status, 502);
    assert.equal(result.body.code, ["invalid", "incomplete"].includes(c.signature) ? "PROVIDER_SIGNATURE_ERROR" : "PROVIDER_HTTP_ERROR");
    assert.equal(result.body.diagnostic.upstreamHttpStatus, status);
    assert.deepEqual(result.body.diagnostic.providerResponse, {
      format: c.format ?? "business_json", providerCode: c.providerCode === null ? null : code,
      signatureState: c.signature ?? "absent", sourceIpReason: c.expected,
    });
    assert.equal(DB.state.writes, 0); assert.equal(DB.state.batchCalls, 0);
    assert.equal(DB.state.events.size, 0); assert.equal(DB.state.attempts, 0);
    assert.deepEqual(DB.state.transaction, transaction);
    assert.equal(DB.state.freeBalance, 200); assert.equal(DB.state.paidBalance, 0);
    assert.doesNotMatch(JSON.stringify(result.body), /private-|"details"|merchant\.example\.test|X-XD-Response|BEGIN .*KEY/);
  });
});

test("source-IP diagnostics remain isolated from Production and unauthorized requests", async () => {
  for (const options of [{environment:"production"}, {authenticated:false}, {csrfValid:false}, {method:"GET"}]) {
    const DB = makeDb(); let calls = 0;
    const target = options.method === "GET" ? `/v1/orders/${orderId}` : `/v1/orders/${orderId}/refresh`;
    const result = await call(target, DB, { ...options, query: async request => {
      calls++;
      return signedProviderResponse(request, { httpStatus: 403, errorCode: "OPEN_API_SOURCE_IP_REJECTED", errorDetails: { reason: "PEER_NOT_TRUSTED" } });
    } });
    assert.equal(result.body.diagnostic, undefined);
    assert.doesNotMatch(JSON.stringify(result.body), /PEER_NOT_TRUSTED|sourceIpReason|providerResponse/);
    assert.equal(calls, options.environment === "production" ? 1 : 0);
    assert.equal(DB.state.writes, 0); assert.equal(DB.state.batchCalls, 0);
  }
});

function makeCheckoutDb() {
  const DB = makeDb(), prepare = DB.prepare.bind(DB);
  DB.state.created = false;
  DB.state.checkoutBatches = [];
  DB.prepare = sql => {
    if (sql.startsWith("SELECT") && sql.includes("system_settings WHERE key='purchase_enabled'")) return {async first(){return {value:"1"};}};
    if (sql.startsWith('SELECT') && sql.includes('system_settings WHERE key IN')) return {bind(){return this;},async all(){return {results:[
      {key:'purchase_enabled',value:'1'},{key:'payment_rsa2_enabled',value:'1'},{key:'payment_epay_enabled',value:'0'},
      {key:'payment_alipay_enabled',value:'1'},{key:'payment_wechat_enabled',value:'0'},
      {key:'payment_rsa2_alipay_released',value:'1'},{key:'payment_wechat_released',value:'0'},
    ]};}};
    if (sql.includes("FROM recharge_packages WHERE id=?")) return {
      bind() { return this; },
      async first() { return { id: "starter", name_zh: "入门包", credits: 400, price_cents: 149, promo_price_cents: null, currency: "USD", price_cny_fen: 990 }; },
    };
    return prepare(sql);
  };
  DB.batch = async statements => {
    DB.state.checkoutBatches.push(statements);
    if (statements.length === 3 && statements[0].args?.[2] === "starter") {
      const changes = DB.state.created ? 0 : 1;
      DB.state.created = true;
      return statements.map(() => ({ meta: { changes } }));
    }
    return statements.map(() => ({ meta: { changes: 1 } }));
  };
  return DB;
}

test("checkout rejection explicitly reports unavailable payment link, preserves UNKNOWN and blocks duplicate orders", async () => {
  for (const environment of ["staging", "production"]) {
    const DB = makeCheckoutDb();
    let calls = 0, providerRequestId;
    const options = { environment, envOverrides: { PAYMENTS_ENABLED: "1", XIAODOU_RSA2_SUBSCRIPTIONS_READY: "1", XIAODOU_SOURCE_IP_CONFIRMED: "1" }, body: { packageId: "starter" }, query: async request => {
      calls++; providerRequestId = request.headers.get("X-XD-Request-Id");
      assert.equal(request.method, "POST");
      assert.equal(new URL(request.url).pathname, "/api/open/v1/payments");
      return signedProviderResponse(request, { httpStatus: 403, errorCode: "OPEN_API_SOURCE_IP_REJECTED", errorDetails: { reason: "HEADER_CONFLICT", private: "sensitive-marker" } });
    } };
    const result = await call("/v1/orders", DB, options);
    assert.equal(result.response.status, 502, JSON.stringify(result.body));
    assert.equal(result.body.order.status, "unknown");
    assert.equal(result.body.order.paymentUrl, null);
    assert.equal(result.body.order.paymentLinkUnavailable, true);
    assert.match(result.body.message, /付款链接未生成/);
    assert.doesNotMatch(result.body.message, /刷新/);
    if (environment === "staging") {
      assert.equal(result.body.requestId, providerRequestId);
      assert.equal(result.body.diagnostic.providerResponse.sourceIpReason, "HEADER_CONFLICT");
      assert.equal(result.body.diagnostic.providerResponse.signatureState, "verified");
      assert.equal(result.body.diagnostic.upstreamHttpStatus, 403);
    } else assert.equal(result.body.diagnostic, undefined);
    assert.doesNotMatch(JSON.stringify(result.body), /sensitive-marker|private-upstream-message|BEGIN.*KEY|X-XD-Sign/);
    assert.equal(DB.state.paidBalance, 0);
    assert.equal(DB.state.events.size, 0);
    const duplicate = await call("/v1/orders", DB, options);
    assert.equal(duplicate.body.code, "UNRESOLVED_ORDER_EXISTS");
    assert.equal(calls, 1, "neither automatic query nor second create request");
  }
});
