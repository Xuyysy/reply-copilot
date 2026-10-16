import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = (name) => readFileSync(path.join(root, "dist", name === "index" ? "index.html" : `${name}/index.html`), "utf8");

test("all required pages build as static HTML", () => {
  for (const name of ["index", "pricing", "checkout", "faq", "guide", "privacy", "terms", "refunds", "login", "account", "admin", "feedback"]) {
    assert.ok(existsSync(path.join(root, "dist", name === "index" ? "index.html" : `${name}/index.html`)), name);
  }
});
test("pricing is accurate and does not expose a fake checkout", () => {
  const html = page("pricing");
  assert.match(html, /注册赠送 200 次/);
  assert.match(html, /无需订阅、买断或自备 API Key/);
  assert.match(html, /付款尚未开放/);
  assert.doesNotMatch(html, /Seven consecutive days|Lifetime license/);
});
test("language switch and responsive layout are present", () => {
  const html = page("index");
  const css = readFileSync(path.join(root, "src/styles/global.css"), "utf8");
  assert.match(html, /id="language-toggle"/);
  assert.match(html, /data-zh="让你的每条 X 回复，更像你自己。"/);
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /replyCopilotLanguage/);
  assert.match(css, /@media \(max-width: 800px\)/);
  assert.match(css, /\.grid-span-2 \{ grid-column: auto; \}/);
});
test("account page requests protected data from the API", () => {
  const source = readFileSync(path.join(root, "src/components/account/AccountDashboard.tsx"), "utf8");
  for (const endpoint of ["/v1/me", "/v1/usage", "/v1/activity", "/v1/extension/approve"]) assert.ok(source.includes(endpoint));
  assert.match(source, /error\.status === 401/);
});
test("interactive pages hydrate as isolated React islands", () => {
  for (const [pageName, component] of [["login", "AuthPanel"], ["account", "AccountDashboard"], ["admin", "AdminDashboard"]]) {
    assert.match(readFileSync(path.join(root, `src/pages/${pageName}.astro`), "utf8"), new RegExp(`<${component} client:load`));
  }
  const admin = readFileSync(path.join(root, "src/components/admin/AdminDashboard.tsx"), "utf8");
  assert.match(admin, /\/v1\/admin\/dashboard/);
  assert.doesNotMatch(admin, /\/v1\/admin\/mfa\/|X-Admin-Access|X-Admin-Session|inputMode="numeric"/);
  assert.match(admin, /AlertDialog/);
  assert.doesNotMatch(admin, /localStorage|window\.confirm|window\.alert/);
});
