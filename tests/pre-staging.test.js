import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("unavailable payments have no public order creation control", () => {
  assert.doesNotMatch(read("web/src/pages/checkout.astro"), /\/v1\/orders|id="create-order"/);
  assert.match(read("api/src/commercial.ts"), /PAYMENT_UNAVAILABLE/);
});

test("production package uses one configured API origin and no direct DeepSeek host", () => {
  const build = read("scripts/build.js");
  assert.match(build, /Production URLs must be configured HTTPS origins/);
  assert.match(build, /manifest\.host_permissions =/);
  assert.doesNotMatch(read("manifest.json"), /api\.deepseek\.com/);
});

test("production build rejects loopback HTTPS origin variants", () => {
  for (const origin of ["https://localhost.", "https://[::1]", "https://127.0.0.1"]) {
    assert.throws(() => execFileSync(process.execPath, ["scripts/build.js", "production"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, REPLY_COPILOT_WEBSITE_URL: "https://web.example.test", REPLY_COPILOT_API_URL: origin },
      stdio: "pipe",
    }), /Production URLs/, origin);
  }
});
