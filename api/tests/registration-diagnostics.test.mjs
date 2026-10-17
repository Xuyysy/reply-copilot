import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { buildSync } from "esbuild";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-diagnostics-"));
const bundlePath = path.join(temp, "worker.cjs");
buildSync({
  entryPoints: [path.join(apiRoot, "src/index.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  outfile: bundlePath,
});
let worker;
let originalError;
let capturedErrors;

before(async () => {
  const loaded = (await import(pathToFileURL(bundlePath))).default;
  worker = loaded.default || loaded;
  originalError = console.error;
  capturedErrors = [];
  console.error = (...values) => capturedErrors.push(values.map(String).join(" "));
});

after(() => {
  console.error = originalError;
  rmSync(temp, { recursive: true, force: true });
});

const canaries = {
  email: "diag-sensitive-email@example.test",
  username: "diag_sensitive_user",
  password: "diag-sensitive-password-987654",
  token: "diag-sensitive-turnstile-token",
  secret: "diag-sensitive-secret-value",
  error: "diag-sensitive-provider-error",
};

function makeDb({ failAt, insertChanges = 1 } = {}) {
  return {
    prepare(sql) {
      const statement = {
        bind() { return statement; },
        async all() {
          if (failAt === "rate_limit") throw new TypeError(canaries.error);
          if (sql.startsWith("INSERT INTO rate_limits")) return { results: [{ used: 1 }] };
          return { results: [] };
        },
        async first() {
          if (failAt === "registration_settings" && sql.includes("system_settings")) throw new TypeError(canaries.error);
          if (sql.includes("system_settings WHERE key='registration_enabled'")) return { value: "1" };
          if (sql.startsWith("SELECT id FROM users")) return null;
          return null;
        },
        async run() {
          if (failAt === "pending_registration_write" && sql.startsWith("INSERT INTO pending_registrations")) throw new TypeError(canaries.error);
          if (failAt === "duplicate_username" && sql.startsWith("INSERT INTO pending_registrations")) throw new Error("UNIQUE constraint failed: pending_registrations.username");
          if (sql.startsWith("INSERT INTO pending_registrations")) return { meta: { changes: insertChanges } };
          return { meta: { changes: 1 } };
        },
      };
      return statement;
    },
  };
}

function makeEnv(options = {}) {
  return {
    ENVIRONMENT: "development",
    WEB_ORIGIN: "http://127.0.0.1:4321",
    API_ORIGIN: "http://127.0.0.1:8787",
    EXTENSION_ORIGIN: "",
    PASSWORD_PEPPER: canaries.secret,
    AUTH_HASH_SECRET: canaries.secret,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
    DB: makeDb(options),
  };
}

function registrationRequest(turnstileToken = canaries.token) {
  return new Request("http://127.0.0.1:8787/v1/auth/register", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:4321", "Content-Type": "application/json" },
    body: JSON.stringify({
      email: canaries.email,
      username: canaries.username,
      password: canaries.password,
      turnstileToken,
    }),
  });
}

function diagnosticLog() {
  const entries = capturedErrors.map((entry) => JSON.parse(entry));
  assert.equal(entries.length, 1);
  return entries[0];
}

test("unexpected D1 error records a safe phase and shares requestId with response", async () => {
  capturedErrors.length = 0;
  const response = await worker.fetch(registrationRequest(), makeEnv({ failAt: "registration_settings" }));
  const body = await response.json();
  const log = diagnosticLog();

  assert.equal(response.status, 503);
  assert.equal(body.code, "SERVER_UNAVAILABLE");
  assert.equal(log.requestId, body.requestId);
  assert.equal(log.route, "/v1/auth/register");
  assert.equal(log.stage, "registration_settings");
  assert.equal(log.category, "TypeError");
  assert.equal(log.state, "unexpected_exception");
  assert.match(log.timestamp, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(Object.keys(log).sort(), ["category", "requestId", "route", "stage", "state", "timestamp"]);
  assert.ok(["TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "Error", "unknown"].includes(log.category));
  for (const value of Object.values(canaries)) {
    assert.equal(JSON.stringify(log).includes(value), false);
    assert.equal(JSON.stringify(body).includes(value), false);
  }
});

test("unexpected password hashing error is attributed to password_hash", async () => {
  capturedErrors.length = 0;
  const deriveBits = crypto.subtle.deriveBits;
  crypto.subtle.deriveBits = async () => { throw new TypeError(canaries.error); };
  try {
    const response = await worker.fetch(registrationRequest("local-test-token"), makeEnv());
    const body = await response.json();
    assert.equal(response.status, 503, `unexpected public response code: ${body.code}`);
    const log = diagnosticLog();
    assert.equal(log.stage, "password_hash");
    assert.equal(log.requestId, body.requestId);
    for (const value of Object.values(canaries)) assert.equal(JSON.stringify(log).includes(value), false);
  } finally {
    crypto.subtle.deriveBits = deriveBits;
  }
});

test("unexpected registration-code HMAC error is attributed after account lookup", async () => {
  capturedErrors.length = 0;
  const sign = crypto.subtle.sign;
  let calls = 0;
  crypto.subtle.sign = async (...args) => {
    calls += 1;
    if (calls === 3) throw new TypeError(canaries.error);
    return sign.call(crypto.subtle, ...args);
  };
  try {
    const response = await worker.fetch(registrationRequest("local-test-token"), makeEnv());
    const body = await response.json();
    const log = diagnosticLog();
    assert.equal(response.status, 503);
    assert.equal(log.stage, "registration_code_hash");
    assert.equal(log.requestId, body.requestId);
    assert.equal(JSON.stringify(log).includes(canaries.error), false);
  } finally {
    crypto.subtle.sign = sign;
  }
});

test("unexpected pending-registration D1 error records its phase", async () => {
  capturedErrors.length = 0;
  const response = await worker.fetch(registrationRequest("local-test-token"), makeEnv({ failAt: "pending_registration_write" }));
  const body = await response.json();
  const log = diagnosticLog();
  assert.equal(response.status, 503);
  assert.equal(body.code, "SERVER_UNAVAILABLE");
  assert.equal(log.stage, "pending_registration_write");
  assert.equal(log.requestId, body.requestId);
  assert.equal(JSON.stringify(log).includes(canaries.error), false);
});

test("known pending username conflict keeps the existing 409 response without an unexpected-error log", async () => {
  capturedErrors.length = 0;
  const response = await worker.fetch(registrationRequest("local-test-token"), makeEnv({ failAt: "duplicate_username" }));
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, "USERNAME_UNAVAILABLE");
  assert.equal(capturedErrors.length, 0);
});

test("known registration business errors keep their status and are not logged as unexpected", async () => {
  capturedErrors.length = 0;
  const request = new Request("http://127.0.0.1:8787/v1/auth/register", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:4321", "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", username: canaries.username, password: canaries.password, turnstileToken: canaries.token }),
  });
  const response = await worker.fetch(request, makeEnv());
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "INVALID_EMAIL");
  assert.match(body.requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(capturedErrors.length, 0);
});

test("unexpected request-body read error is separated from origin validation", async () => {
  capturedErrors.length = 0;
  const request = new Request("http://127.0.0.1:8787/v1/auth/register", {
    method: "POST",
    headers: { Origin: "http://127.0.0.1:4321", "Content-Type": "application/json" },
    body: new ReadableStream({ start(controller) { controller.error(new TypeError(canaries.error)); } }),
    duplex: "half",
  });
  const response = await worker.fetch(request, makeEnv());
  const body = await response.json();
  const log = diagnosticLog();
  assert.equal(response.status, 503);
  assert.equal(log.stage, "request_validation");
  assert.equal(log.requestId, body.requestId);
  assert.equal(JSON.stringify(log).includes(canaries.error), false);
});

test("successful registration keeps its existing response behavior without diagnostic errors", async () => {
  capturedErrors.length = 0;
  const response = await worker.fetch(registrationRequest("local-test-token"), makeEnv({ insertChanges: 0 }));
  const body = await response.json();
  assert.equal(response.status, 200, `unexpected public response code: ${body.code}`);
  assert.equal(body.ok, true);
  assert.equal(body.message, "如果信息可用于注册，验证码已发送。");
  assert.equal(capturedErrors.length, 0);
});
