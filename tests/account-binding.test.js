import test from "node:test";
import assert from "node:assert/strict";
import { AccountClient, ACCOUNT_DEVICE_ID_KEY, ACCOUNT_PENDING_DEVICE_KEY, ACCOUNT_TOKEN_KEY } from "../services/account-client.js";
import { AIProviderRouter } from "../services/ai-provider-router.js";
import { createAccountState } from "../domain/account-state.js";

const config = { channel: "development", websiteUrl: "http://127.0.0.1:4321", hostedApiUrl: "http://127.0.0.1:8787", allowedHttpHosts: ["127.0.0.1"] };
function localStorage() {
  const data = {};
  return { data, async get(key) { return { [key]: data[key] }; }, async set(patch) { Object.assign(data, patch); }, async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; } };
}

test("device binding opens only the website code, never a bearer token URL", async () => {
  const storage = localStorage();
  const opened = [];
  let exchanges = 0;
  let codes = 0;
  const client = new AccountClient({ config, storage, openTab: async (url) => { opened.push(url); }, fetchImpl: async (url, options) => {
    const path = new URL(url).pathname;
    if (path === "/v1/extension/device-code") { codes++; return { ok: true, json: async () => ({ deviceCode: "AB12CD34", deviceToken: "a".repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString() }) }; }
    if (path === "/v1/extension/exchange") return { ok: true, json: async () => exchanges++ === 0 ? { status: "pending" } : { status: "approved", accessToken: "b".repeat(64) } };
    if (path === "/v1/auth/logout") return { ok: true, json: async () => ({ ok: true }) };
    throw new Error(path);
  } });
  assert.equal(await client.beginDeviceAuthorization(), "AB12CD34");
  assert.match(storage.data[ACCOUNT_DEVICE_ID_KEY], /^[0-9a-f-]{36}$/);
  assert.deepEqual(opened, ["http://127.0.0.1:4321/account?device_code=AB12CD34"]);
  assert.equal(await client.beginDeviceAuthorization({ mode: "register" }), "AB12CD34");
  assert.equal(codes, 1);
  assert.equal(opened[1], "http://127.0.0.1:4321/account?device_code=AB12CD34");
  assert.doesNotMatch(opened[0], /a{64}|b{64}/);
  assert.equal(await client.pollDeviceAuthorization(), false);
  assert.equal(await client.pollDeviceAuthorization(), true);
  assert.equal(storage.data[ACCOUNT_TOKEN_KEY], "b".repeat(64));
  assert.equal(storage.data[ACCOUNT_PENDING_DEVICE_KEY], null);
  await assert.rejects(client.beginDeviceAuthorization(), /已连接/);
  await client.logout();
  assert.equal(storage.data[ACCOUNT_TOKEN_KEY], undefined);
});

test("production credit account routes to hosted AI without reading a personal key", async () => {
  let hostedCalls = 0;
  const provider = new AIProviderRouter({
    config,
    accountStates: { getState: async () => createAccountState({ status: "credits_available",quota:{freeRemaining:200,paidRemaining:0,totalRemaining:200} }, "server") },
    hostedFactory: () => ({ generateReplies: async () => { hostedCalls++; return "reply"; } }),
  });
  assert.equal(await provider.generateReplies({}), "reply");
  assert.equal(hostedCalls, 1);
});
