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
  const state = { transaction: { ...transaction }, sessionUser: "owner-user", freeBalance: 200, paidBalance: 0, events: new Map(), writes: 0, batchCalls: 0, attempts: 0 };
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
            Object.assign(state.transaction, { provider_fee_projection_status: this.args[0], provider_fee_projection_json: this.args[1], provider_fee_projection_issue: this.args[2] });
          }
          if (sql.includes("INSERT INTO payment_attempts")) state.attempts++;
          return { meta: { changes: 1 } };
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

function env(DB) {
  return {
    ENVIRONMENT: "staging", WEB_ORIGIN: webOrigin, API_ORIGIN: "https://api-staging.x-reply-helper.top",
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

async function signedProviderResponse(request, { status = "SUCCEEDED", amountFen = 1006, outTradeNo = transaction.provider_trade_id } = {}) {
  const requestId = request.headers.get("X-XD-Request-Id");
  const payload = JSON.stringify({ outTradeNo, amountFen, currency: "CNY", status, feeProjection });
  const timestamp = String(Math.floor(Date.now() / 1000)), nonce = "provider-nonce-1234", keyId = "platform-test-key";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const canonical = ["XD-Response-v1", "200", "application/json", requestId, timestamp, nonce, keyId, hex].join("\n");
  const signature = sign("RSA-SHA256", Buffer.from(canonical), platform.privateKey).toString("base64");
  return new Response(payload, { status: 200, headers: {
    "Content-Type": "application/json", "X-XD-Response-Sign": signature, "X-XD-Response-Key-Id": keyId,
    "X-XD-Response-Timestamp": timestamp, "X-XD-Response-Nonce": nonce, "X-XD-Request-Id": requestId,
  } });
}

async function call(path, DB, { userId = "owner-user", method = "POST", body, query = async (request) => signedProviderResponse(request) } = {}) {
  const csrf = await csrfToken();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => query(new Request(url, init));
  try {
    const request = new Request(`https://api-staging.x-reply-helper.top${path}`, {
      method, headers: { Origin: webOrigin, Cookie: `rc_session=${sessionToken}`,
        ...(method === "POST" ? { "X-CSRF-Token": csrf, "X-Reply-Copilot-Action": "1", "Content-Type": "application/json", ...(body ? {} : {}) } : {}),
      }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    DB.state.sessionUser = userId;
    const response = await worker.fetch(request, env(DB));
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

test("payments-off refresh enforces ownership and does not call provider for another user's order", async () => {
  const DB = makeDb(); let providerCalls = 0;
  const result = await call(`/v1/orders/${orderId}/refresh`, DB, { userId: "other-user", query: async () => { providerCalls++; return new Response(); } });
  assert.equal(result.response.status, 404);
  assert.equal(result.body.code, "ORDER_NOT_FOUND");
  assert.equal(providerCalls, 0);
  assert.equal(DB.state.writes, 0);
});

test("repeated trusted queries are idempotent; provider failures never mark paid", async () => {
  const DB = makeDb();
  const failed = await call(`/v1/orders/${orderId}/refresh`, DB, { query: async () => { throw new Error("offline"); } });
  assert.equal(failed.response.status, 503);
  assert.equal(DB.state.transaction.status, "unknown");
  assert.equal(DB.state.paidBalance, 0);
  assert.equal(DB.state.batchCalls, 0);

  const first = await call(`/v1/orders/${orderId}/refresh`, DB);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.quota.paidRemaining, 400);
  const second = await call(`/v1/orders/${orderId}/refresh`, DB);
  assert.equal(second.response.status, 200);
  assert.equal(second.body.quota.paidRemaining, 400);
  assert.equal(DB.state.batchCalls, 1, "the same paid order is granted once across repeated trusted queries");
  assert.equal(DB.state.paidBalance, 400);
  assert.equal(DB.state.events.size, 1);
  assert.equal(DB.state.attempts, 0);
});
