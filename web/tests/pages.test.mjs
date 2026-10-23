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
test("public pages use the exact x-Reply-Helper brand", () => {
  for (const name of ["index", "pricing", "checkout", "faq", "guide", "privacy", "terms", "refunds", "login", "account", "admin", "feedback"]) {
    const html = readFileSync(path.join(root, "dist", name === "index" ? "index.html" : `${name}/index.html`), "utf8");
    assert.match(html, /<meta property="og:site_name" content="x-Reply-Helper"/);
    assert.match(html, /<title>[^<]*x-Reply-Helper<\/title>/);
    assert.match(html, /aria-label="x-Reply-Helper home"/);
    assert.doesNotMatch(html, /Reply Copilot|REPLY COPILOT/);
  }
});
test("pricing renders USD reference and server-set CNY settlement values", () => {
  const html = page("pricing");
  const source = readFileSync(path.join(root, "src/pages/pricing.astro"), "utf8");
  const migration = readFileSync(path.resolve(root, "../api/migrations/0005_xiaodou_payments.sql"), "utf8");
  const homepage = page("index");
  assert.match(html, /注册赠送 200 次/);
  assert.match(html, /无需订阅、买断或自备 API Key/);
  assert.match(html, /付款尚未开放/);
  assert.match(source, /fee_rate_bps|feeRateBps/);
  assert.doesNotMatch(source, /¥9\.90|¥19\.90|¥32\.90/);
  assert.match(source, /toFixed\(2\)/);
  assert.match(migration, /price_cents=149,price_cny_fen=990/);
  assert.match(migration, /price_cents=299,price_cny_fen=1990/);
  assert.match(migration, /price_cents=499,price_cny_fen=3290/);
  assert.doesNotMatch(homepage, /¥9\.90|¥19\.90|¥32\.90/);
  assert.doesNotMatch(html, /Seven consecutive days|Lifetime license/);
});
test("checkout offers an explicit payment flow and never trusts a browser-submitted amount", () => {
  const html = page("checkout");
  const source = readFileSync(path.join(root, "src/pages/checkout.astro"), "utf8");
  assert.match(html, /使用支付宝付款|Pay with Alipay/);
  assert.match(html, /模拟支付完成|Simulate payment/);
  assert.match(source, /amountFen/);
  assert.match(source, /packageId/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
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
  for (const endpoint of ["/v1/me", "/v1/usage", "/v1/activity", "/v1/extension/device-code/status", "/v1/extension/approve"]) assert.ok(source.includes(endpoint));
  assert.match(source, /error\.status === 401/);
  assert.match(source, /<Dialog open=/);
});
test("account orders expose provider refresh for unresolved supported merchant payments", () => {
  const source = readFileSync(path.join(root, "src/components/account/AccountDashboard.tsx"), "utf8");
  const refresh = readFileSync(path.join(root, "src/lib/payment-refresh.mjs"), "utf8");
  const api = readFileSync(path.join(root, "src/lib/api.ts"), "utf8");
  assert.match(refresh, /\/v1\/orders\/\$\{encodeURIComponent\(orderId\)\}\/refresh/);
  assert.match(source, /payment_status/);
  assert.match(source, /canRefreshPaymentOrder\(order\)/);
  assert.match(refresh, /\["xiaodou","mk99"\]\.includes\(order\?\.provider\)/);
  assert.match(refresh, /order\.status === "awaiting_payment"/);
  assert.match(source, /data-order-refresh/);
  assert.match(source, /refreshingOrderId===order\.id/);
  assert.match(source, /disabled=\{busy\|\|refreshingOrderId===order\.id\}/);
  assert.match(source, /diagnostic\.stage/);
  assert.match(api, /diagnostic\?:/);
  assert.match(api, /requestId\?:/);
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
