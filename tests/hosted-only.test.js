import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFileSync(path.join(root, name), "utf8");

test("extension generation has no direct DeepSeek client or personal key route", () => {
  assert.equal(existsSync(path.join(root, "services/deepseek-client.js")), false);
  const router = read("services/ai-provider-router.js");
  assert.doesNotMatch(router, /DeepSeekClient|byokFactory|getApiKey/);
  assert.match(router, /HostedAIClient/);
});

test("extension UI does not ask users for a personal AI key", () => {
  for (const name of ["options/options.html", "onboarding/onboarding.html", "privacy.html"]) {
    assert.doesNotMatch(read(name), /id="api-key"|data-panel="ai"|自带 Key|个人 BYOK|本地开发模式为 DeepSeek/, name);
  }
});

test("frozen accounts receive explicit status in both extension surfaces", () => {
  assert.match(read("sidepanel/sidepanel.js"), /账户已冻结/);
  assert.match(read("content/inline-assistant.js"), /账户已冻结/);
});

test("extension upgrade migrates legacy style before removing the old personal key", () => {
  const background = read("background/service-worker.js");
  assert.ok(background.indexOf("profiles.migrateLegacy(") < background.indexOf("storage.migrateSchema()"));
});
