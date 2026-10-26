import test from "node:test";
import assert from "node:assert/strict";
import { validOutput } from "./helpers.js";

const values = { replyCopilotAccountToken: "local-test-token" };
const local = {
  async get(key) { return typeof key === "string" ? { [key]: values[key] } : Object.fromEntries(key.map((item) => [item, values[item]])); },
  async set() { throw new Error("Local usage storage unavailable"); },
  async remove() {},
};
const event = () => ({ addListener(listener) { this.listener = listener; } });
globalThis.chrome = { runtime: { id: "test-extension", onInstalled: event(), onMessage: event() }, contextMenus: { onClicked: event() }, storage: { onChanged: event(), local, session: { get: async () => ({}), set: async () => {} } }, debugger: {}, permissions: { contains: async () => true }, sidePanel: {} };
globalThis.fetch = async (url) => {
  const pathname = new URL(url).pathname;
  const data = pathname === "/v1/me" ? { user: { username: "tester" } }
    : pathname === "/v1/entitlements" ? { status: "credits_available", entitlement: {} }
    : pathname === "/v1/usage" ? { quota: { freeRemaining: 200, paidRemaining: 0, totalRemaining: 200 } }
    : pathname === "/v1/ai/generate" ? { raw: JSON.stringify(validOutput), quota: { freeRemaining: 199, paidRemaining: 0, totalRemaining: 199 } }
    : {};
  return { ok: true, json: async () => data };
};
await import("../background/service-worker.js");

test("background returns AI draft even when saving local history fails", async () => {
  const response = await new Promise((resolve) => chrome.runtime.onMessage.listener({ type: "REPLY_COPILOT_GENERATE", requestId: crypto.randomUUID(), sourceText: "这是一个帖子", sourceUrl: "https://x.com/example/status/123456" }, { id: "test-extension", url: "https://x.com/home" }, resolve));
  assert.equal(response.ok, true);
  assert.equal(response.result.replies.natural, "A casual thought.");
  assert.match(response.accountLabel, /剩余 199 次/);
});
