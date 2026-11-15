import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (name) => readFileSync(new URL("../" + name, import.meta.url), "utf8");

test("unavailable payments keep checkout disabled and the API rejects order creation", () => {
  const checkout = read("web/src/pages/checkout.astro");
  assert.match(checkout, /byId\("create-order"\)\.disabled=busy\|\|paymentRail!=='fiat'\|\|!paymentAvailable/);
  assert.match(checkout, /if\(!selected\|\|busy\|\|\(!restart&&order\)\|\|!paymentAvailable\|\|paymentRail!=='fiat'\)return/);
  assert.match(read("api/src/payments.ts"), /PAYMENT_UNAVAILABLE/);
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

test("staging extension package uses the staging origins and excludes development-only code", () => {
  execFileSync(process.execPath, ["scripts/build.js", "staging"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      REPLY_COPILOT_WEBSITE_URL: "https://staging.x-reply-helper.top",
      REPLY_COPILOT_API_URL: "https://api-staging.x-reply-helper.top",
    },
    stdio: "pipe",
  });

  const manifest = JSON.parse(read("dist/staging/manifest.json"));
  const runtime = read("dist/staging/config/runtime.js");
  assert.deepEqual(manifest.host_permissions, ["https://api-staging.x-reply-helper.top/*"]);
  assert.match(runtime, /channel: "staging"/);
  assert.match(runtime, /https:\/\/staging\.x-reply-helper\.top/);
  assert.match(runtime, /https:\/\/api-staging\.x-reply-helper\.top/);
  assert.equal(existsSync(new URL("../dist/staging/dev", import.meta.url)), false);
  assert.equal(existsSync(new URL("../dist/staging/services/deepseek-client.js", import.meta.url)), false);
});
