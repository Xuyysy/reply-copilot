import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = path.join(root, "node_modules", ".bin", "wrangler");
const persist = mkdtempSync(path.join(os.tmpdir(), "reply-copilot-e2e-"));
const base = "http://127.0.0.1:8792";
const origin = "http://127.0.0.1:4321";
const env = { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(persist, "wrangler.log") };
const sql = (statement) => execFileSync(wrangler, ["d1", "execute", "DB", "--local", "--persist-to", persist, "--command", statement], { cwd: root, env, stdio: "pipe" });
let server;
let logs = "";
let count = 0;
async function call(url, { method = "GET", body, cookie, bearer, csrf, extension = false } = {}) {
  const response = await fetch(`${base}${url}`, { method, headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(method === "POST" && !extension ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(csrf ? { "X-CSRF-Token": csrf, "X-Reply-Copilot-Action": "1" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, headers: response.headers, data: await response.json() };
}
async function waitFor(predicate, maxMs = 15000) {
  const until = Date.now() + maxMs;
  while (Date.now() < until) { const value = await predicate(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 100)); }
  throw new Error(`Timed out waiting for local Worker. ${logs.slice(-500)}`);
}
try {
  execFileSync(wrangler, ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persist], { cwd: root, env, stdio: "pipe" });
  server = spawn(wrangler, ["dev", "--local", "--ip", "127.0.0.1", "--port", "8792", "--persist-to", persist], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (data) => { logs += data.toString(); });
  server.stderr.on("data", (data) => { logs += data.toString(); });
  await waitFor(async () => { try { return (await call("/health")).status === 200; } catch { return false; } });
  const email = `e2e-${crypto.randomUUID()}@example.test`;
  assert.equal((await call("/v1/me")).status, 401);
  assert.equal((await call("/v1/auth/request-code", { method: "POST", body: { email } })).status, 200);
  const code = await waitFor(() => logs.match(new RegExp(`\\[LOCAL EMAIL ONLY\\] ${email}: (\\d{6})`))?.[1]);
  assert.equal((await call("/v1/auth/verify-code", { method: "POST", body: { email, code: "000000" } })).status, 400);
  const login = await call("/v1/auth/verify-code", { method: "POST", body: { email, code } });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("rc_session="));
  assert.equal((await call("/v1/auth/verify-code", { method: "POST", body: { email, code } })).status, 400);
  const entitlement = await call("/v1/entitlements", { cookie });
  assert.equal(entitlement.data.status, "trial_active");
  assert.ok(Math.abs(new Date(entitlement.data.trial.expiresAt).getTime() - new Date(entitlement.data.trial.startedAt).getTime() - 7 * 86400_000) < 1);
  assert.equal((await call("/v1/usage", { cookie })).data.quota.dailyRemaining, 30);
  const device = await call("/v1/extension/device-code", { method: "POST", extension: true, body: { deviceId: crypto.randomUUID() } });
  assert.equal(device.status, 200);
  assert.equal((await call("/v1/extension/exchange", { method: "POST", extension: true, body: { deviceToken: device.data.deviceToken } })).data.status, "pending");
  const csrf = (await call("/v1/auth/csrf", { cookie })).data.csrfToken;
  assert.equal((await call("/v1/extension/approve", { method: "POST", cookie, body: { deviceCode: device.data.deviceCode } })).status, 403);
  assert.equal((await call("/v1/extension/approve", { method: "POST", cookie, csrf, body: { deviceCode: device.data.deviceCode } })).status, 200);
  const exchanged = await call("/v1/extension/exchange", { method: "POST", extension: true, body: { deviceToken: device.data.deviceToken } });
  assert.equal(exchanged.status, 200);
  const bearer = exchanged.data.accessToken;
  assert.equal((await call("/v1/extension/exchange", { method: "POST", extension: true, body: { deviceToken: device.data.deviceToken } })).status, 400);
  const post = { text: "Small steps add up.", url: "https://x.com/example/status/123" };
  const generate = (requestId) => call("/v1/ai/generate", { method: "POST", extension: true, bearer, body: { requestId, post, replyStyle: "natural-friendly", outputSchemaVersion: 1 } });
  assert.equal((await call("/v1/ai/generate", { method: "POST", body: { requestId: crypto.randomUUID(), post } })).status, 401);
  const firstId = crypto.randomUUID();
  const first = await generate(firstId); assert.equal(first.status, 200); count++;
  assert.equal((await generate(firstId)).status, 200);
  assert.equal((await call("/v1/usage", { cookie })).data.quota.dailyUsed, 1);
  const conflict = await call("/v1/ai/generate", { method: "POST", extension: true, bearer, body: { requestId: firstId, post: { ...post, text: "Different" } } });
  assert.equal(conflict.status, 409);
  for (let i = 1; i < 29; i++) { const result = await generate(crypto.randomUUID()); assert.equal(result.status, 200, JSON.stringify(result.data)); count++; }
  const edge = await Promise.all([generate(crypto.randomUUID()), generate(crypto.randomUUID())]);
  assert.equal(edge.filter((result) => result.status === 200).length, 1, JSON.stringify(edge.map((result) => result.status)));
  count++;
  const exceeded = await generate(crypto.randomUUID());
  assert.equal(exceeded.status, 429);
  assert.equal(exceeded.data.code, "QUOTA_EXCEEDED");
  assert.equal((await call("/v1/usage", { cookie })).data.quota.dailyRemaining, 0);
  assert.equal((await call("/v1/entitlements", { cookie })).data.status, "trial_exhausted");
  const secondEmail = `parallel-${crypto.randomUUID()}@example.test`;
  assert.equal((await call("/v1/auth/request-code", { method: "POST", body: { email: secondEmail } })).status, 200);
  const secondCode = await waitFor(() => logs.match(new RegExp(`\\[LOCAL EMAIL ONLY\\] ${secondEmail}: (\\d{6})`))?.[1]);
  const secondLogin = await call("/v1/auth/verify-code", { method: "POST", body: { email: secondEmail, code: secondCode } });
  assert.equal(secondLogin.status, 200);
  const secondCookie = secondLogin.headers.get("set-cookie")?.split(";")[0];
  const secondDevice = await call("/v1/extension/device-code", { method: "POST", extension: true, body: { deviceId: crypto.randomUUID() } });
  const secondCsrf = (await call("/v1/auth/csrf", { cookie: secondCookie })).data.csrfToken;
  assert.equal((await call("/v1/extension/approve", { method: "POST", cookie: secondCookie, csrf: secondCsrf, body: { deviceCode: secondDevice.data.deviceCode } })).status, 200);
  const secondBearer = (await call("/v1/extension/exchange", { method: "POST", extension: true, body: { deviceToken: secondDevice.data.deviceToken } })).data.accessToken;
  const parallel = await Promise.all(Array.from({length: 31}, () => call("/v1/ai/generate", { method: "POST", extension: true, bearer: secondBearer, body: { requestId: crypto.randomUUID(), post } })));
  const parallelSuccess = parallel.filter((result) => result.status === 200).length;
  const parallelUsed = (await call("/v1/usage", { cookie: secondCookie })).data.quota.dailyUsed;
  assert.ok(parallelSuccess <= 30 && parallelUsed <= 30);
  assert.equal(parallelSuccess, parallelUsed);
  assert.ok(parallel.every((result) => [200, 429].includes(result.status)), JSON.stringify(parallel.filter((result) => ![200,429].includes(result.status)).map((result) => result.data)));
  const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0,10);
  sql(`UPDATE site_daily_usage SET used=300 WHERE quota_date='${today}'`);
  const budget = await call("/v1/ai/generate", { method: "POST", extension: true, bearer: secondBearer, body: { requestId: crypto.randomUUID(), post } });
  assert.equal(budget.status, 503);
  assert.equal(budget.data.code, "HOSTED_BUDGET_EXHAUSTED");
  const expired = Date.now() - 1;
  sql(`UPDATE trials SET started_at=${expired - 7 * 86400_000},expires_at=${expired} WHERE user_id=(SELECT id FROM users WHERE email='${secondEmail}')`);
  const afterExpiry = await call("/v1/ai/generate", { method: "POST", extension: true, bearer: secondBearer, body: { requestId: crypto.randomUUID(), post } });
  assert.equal(afterExpiry.status, 403);
  assert.equal(afterExpiry.data.code, "TRIAL_EXPIRED");
  assert.equal((await call("/v1/auth/logout", { method: "POST", cookie, csrf, body: {} })).status, 200);
  assert.equal((await call("/v1/me", { cookie })).status, 401);
  console.log(JSON.stringify({ ok: true, generations: count, remaining: 0, concurrentSuccessful: parallelSuccess, concurrentUsed: parallelUsed, duplicateCharged: false, csrfRejected: true, reuseRejected: true, budgetStopped: true, expiredStopped: true }));
} finally {
  server?.kill("SIGTERM");
  rmSync(persist, { recursive: true, force: true });
}
