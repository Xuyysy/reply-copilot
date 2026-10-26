import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-xiaodou-diagnostic-"));
const bundlePath = path.join(temp, "worker.cjs");
buildSync({ entryPoints: [path.join(apiRoot, "src/index.ts")], bundle: true, platform: "node", format: "cjs", target: "node22", outfile: bundlePath });
const loaded = await import(pathToFileURL(bundlePath));
const worker = loaded.default?.default || loaded.default;

const token = "a".repeat(64);
const authSecret = "xiaodou-diagnostic-test-auth-secret-long-enough";
const webOrigin = "https://staging.x-reply-helper.top";
const secretMarker = "DO_NOT_LOG_DIAGNOSTIC_SECRET_MARKER";

function makeDb({ role = "admin", status = "active", verified = Date.now(), rateAllowed = true } = {}) {
  const state = { rateAllowed, rateCalls: 0, accountLookupCalls: 0, roleLookupCalls: 0 };
  return {
    state,
    prepare(sql) {
      return {
        bind(...args) { this.args = args; return this; },
        async first() {
          if (sql.includes("FROM sessions JOIN users")) {
            return this.args[1] === "web" ? { id: "session-1", user_id: "user-1", email: "admin@example.test", kind: "web", device_id: null, csrf_token_hash: null, expires_at: Date.now() + 60_000 } : null;
          }
          if (sql.includes("SELECT status,email_verified_at FROM users WHERE id=?")) {
            state.accountLookupCalls++;
            return { role, status, email_verified_at: verified };
          }
          return null;
        },
        async all() {
          if (sql.includes("INSERT INTO rate_limits")) {
            state.rateCalls++;
            return { results: state.rateAllowed ? [{ used: 1 }] : [] };
          }
          return { results: [] };
        },
      };
    },
  };
}

function makeEnv(DB, overrides = {}) {
  return {
    ENVIRONMENT: "staging", WEB_ORIGIN: webOrigin, API_ORIGIN: "https://api-staging.x-reply-helper.top",
    EXTENSION_ORIGIN: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ADMIN_PORTAL_ENABLED: "0",
    XIAODOU_NETWORK_DIAGNOSTIC_ENABLED: "1", XIAODOU_BASE_URL: "https://merchant.example.test",
    AUTH_HASH_SECRET: authSecret, DB, ...overrides,
  };
}

async function csrfToken() {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`csrf:${token}`));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function call(DB, { env = {}, headers = { Origin: webOrigin, Cookie: `rc_session=${token}`, "X-Reply-Copilot-Action": "1" }, includeCsrf = true, fetcher = async () => new Response(null, { status: 404 }), method = "POST" } = {}) {
  const csrf = await csrfToken();
  const originalFetch = globalThis.fetch;
  let observedRequest;
  globalThis.fetch = async (input, init) => {
    observedRequest = { url: String(input), init };
    return fetcher(input, init);
  };
  try {
    const request = new Request("https://api-staging.x-reply-helper.top/v1/admin/diagnostics/xiaodou-connectivity", {
      method, headers: { ...headers, ...(includeCsrf && headers.Cookie ? { "X-CSRF-Token": csrf } : {}) },
    });
    const response = await worker.fetch(request, makeEnv(DB, env));
    return { response, body: await response.json(), observedRequest };
  } finally { globalThis.fetch = originalFetch; }
}

test.after(() => rmSync(temp, { recursive: true, force: true }));

test("Staging admin can run one credential-free root GET even while the admin portal is disabled", async () => {
  const db = makeDb();
  const result = await call(db, { env: { XIAODOU_BASE_URL: "https://merchant.example.test/" }, fetcher: async () => new Response("not found", { status: 404 }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.connected, true);
  assert.equal(result.body.httpStatus, 404);
  assert.equal(result.body.category, "http_response");
  assert.match(result.body.baseUrlSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.observedRequest.url, "https://merchant.example.test/");
  assert.equal(result.observedRequest.init.method, "GET");
  assert.equal(result.observedRequest.init.redirect, "manual");
  assert.equal(result.observedRequest.init.credentials, "omit");
  assert.ok(result.observedRequest.init.signal instanceof AbortSignal);
  assert.deepEqual([...new Headers(result.observedRequest.init.headers).entries()], []);
  assert.equal(db.state.rateCalls, 1);
});

test("regular Staging web user with valid session and CSRF can run diagnostic without role authorization", async () => {
  const db = makeDb({ role: "user" });
  const result = await call(db, { fetcher: async () => new Response(null, { status: 404 }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.category, "http_response");
  assert.equal(db.state.rateCalls, 1);
  assert.equal(db.state.accountLookupCalls, 1);
  assert.equal(db.state.roleLookupCalls, 0);
});

test("invalid Base URL shapes are rejected before fetch", async (t) => {
  for (const [label, baseUrl] of [
    ["path prefix", "https://merchant.example.test/prefix/"],
    ["query", "https://merchant.example.test/?mode=secret"],
    ["empty query marker", "https://merchant.example.test/?"],
    ["fragment", "https://merchant.example.test/#secret"],
    ["empty fragment marker", "https://merchant.example.test/#"],
    ["userinfo", "https://user:password@merchant.example.test/"],
    ["empty userinfo marker", "https://@merchant.example.test/"],
    ["http", "http://merchant.example.test/"],
  ]) {
    await t.test(label, async () => {
      const result = await call(makeDb(), { env: { XIAODOU_BASE_URL: baseUrl } });
      assert.equal(result.response.status, 200);
      assert.equal(result.body.connected, false);
      assert.equal(result.body.category, "invalid_base_url");
      assert.equal(result.observedRequest, undefined);
      assert.equal(JSON.stringify(result.body).includes("merchant.example.test"), false);
      assert.equal(JSON.stringify(result.body).includes("secret"), false);
    });
  }
});

test("missing sessions, inactive or unverified accounts, and CSRF-invalid requests cannot access diagnostic", async (t) => {
  const cases = [
    ["missing session", makeDb(), { Origin: webOrigin }, 401],
    ["frozen user", makeDb({ role: "user", status: "frozen" }), undefined, 403],
    ["unverified user", makeDb({ role: "user", verified: null }), undefined, 403],
    ["missing CSRF", makeDb(), { Origin: webOrigin, Cookie: `rc_session=${token}`, "X-Reply-Copilot-Action": "1" }, 403],
    ["invalid CSRF", makeDb(), { Origin: webOrigin, Cookie: `rc_session=${token}`, "X-Reply-Copilot-Action": "1", "X-CSRF-Token": "invalid" }, 403],
  ];
  for (const [label, db, headers, status] of cases) await t.test(label, async () => {
    const result = await call(db, { headers, includeCsrf: !["missing CSRF", "invalid CSRF"].includes(label) });
    assert.equal(result.response.status, status);
    assert.equal(result.observedRequest, undefined);
  });
});

test("feature flag and Staging environment are required without opening other admin APIs", async (t) => {
  for (const [label, env] of [
    ["flag disabled", { XIAODOU_NETWORK_DIAGNOSTIC_ENABLED: "0" }],
    ["production", { ENVIRONMENT: "production", XIAODOU_NETWORK_DIAGNOSTIC_ENABLED: "1" }],
  ]) await t.test(label, async () => {
    const result = await call(makeDb(), { env });
    assert.equal(result.response.status, 404);
    assert.equal(result.observedRequest, undefined);
  });
  const ordinaryAdminCall = await worker.fetch(new Request("https://api-staging.x-reply-helper.top/v1/admin/dashboard", {
    headers: { Origin: webOrigin, Cookie: `rc_session=${token}` },
  }), makeEnv(makeDb()));
  assert.equal(ordinaryAdminCall.status, 404, "diagnostic gate must not enable the ordinary admin portal");
});

test("fetch rejection exposes only allowlisted name and generic category", async () => {
  const originalInfo = console.info;
  const logs = [];
  console.info = (line) => logs.push(String(line));
  try {
    const result = await call(makeDb(), { fetcher: async () => { throw new TypeError(`fetch failed ${secretMarker} merchant.example.test`); } });
    assert.equal(result.response.status, 200);
    assert.equal(result.body.connected, false);
    assert.equal(result.body.httpStatus, null);
    assert.equal(result.body.exceptionName, "TypeError");
    assert.equal(result.body.category, "fetch_rejected");
    assert.equal(JSON.stringify(result.body).includes(secretMarker), false);
    assert.equal(JSON.stringify(result.body).includes("merchant.example.test"), false);
    assert.equal(logs.length, 1);
    assert.equal(logs[0].includes(secretMarker), false);
    assert.equal(logs[0].includes("merchant.example.test"), false);
  } finally { console.info = originalInfo; }
});

test("timeout is classified from the diagnostic's own abort signal", async () => {
  const result = await call(makeDb(), { fetcher: async (_input, init) => new Promise((_, reject) => {
    init.signal.addEventListener("abort", () => reject(new DOMException("private timeout detail", "AbortError")), { once: true });
  }) });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.connected, false);
  assert.equal(result.body.httpStatus, null);
  assert.equal(result.body.exceptionName, "AbortError");
  assert.equal(result.body.category, "timeout");
  assert.equal(JSON.stringify(result.body).includes("private timeout detail"), false);
});

test("diagnostic is rate limited before a second outbound probe", async () => {
  const db = makeDb({ rateAllowed: false });
  const result = await call(db);
  assert.equal(result.response.status, 429);
  assert.equal(result.observedRequest, undefined);
  assert.equal(db.state.rateCalls, 1);
});
