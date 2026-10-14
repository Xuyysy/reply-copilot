import test from "node:test";
import assert from "node:assert/strict";
import { validOutput } from "./helpers.js";

const values = { deepseekApiKey: "sk-test-user", replyCopilotDevMockState: "developer_mode" };
const local = {
  async get(key) { return typeof key === "string" ? { [key]: values[key] } : Object.fromEntries(key.map((item) => [item, values[item]])); },
  async set() { throw new Error("Local usage storage unavailable"); },
  async remove() {},
};
const event = () => ({ addListener(listener) { this.listener = listener; } });
globalThis.chrome = { runtime: { id: "test-extension", onInstalled: event(), onMessage: event() }, contextMenus: { onClicked: event() }, storage: { onChanged: event(), local, session: { get: async () => ({}), set: async () => {} } }, debugger: {}, permissions: { contains: async () => true }, sidePanel: {} };
globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(validOutput) } }] }) });
await import("../background/service-worker.js");

test("background returns AI draft even when saving local history fails", async () => {
  const response = await new Promise((resolve) => chrome.runtime.onMessage.listener({ type: "REPLY_COPILOT_GENERATE", requestId: crypto.randomUUID(), sourceText: "这是一个帖子", sourceUrl: "https://x.com/example/status/123456" }, { id: "test-extension", url: "https://x.com/home" }, resolve));
  assert.equal(response.ok, true);
  assert.equal(response.result.replies.natural, "A casual thought.");
  assert.match(response.accountLabel, /本地开发测试/);
});
