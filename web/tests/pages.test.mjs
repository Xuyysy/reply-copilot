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
  assert.match(html, /新人绑定后领 200 次/);
  assert.match(html, /无需订阅、买断或自备 API Key/);
  assert.match(html, /付款尚未开放/);
  assert.match(source, /fee_rate_bps|feeRateBps/);
  assert.doesNotMatch(source, /¥9\.90|¥19\.90|¥32\.90/);
  assert.match(source, /packageSummary/);
  assert.match(migration, /price_cents=149,price_cny_fen=990/);
  assert.match(migration, /price_cents=299,price_cny_fen=1990/);
  assert.match(migration, /price_cents=499,price_cny_fen=3290/);
  assert.doesNotMatch(homepage, /¥9\.90|¥19\.90|¥32\.90/);
  assert.doesNotMatch(html, /Seven consecutive days|Lifetime license/);
});
test("signup copy gives concise account-connection guidance without exposing claim mechanics",()=>{
  const login=page("login"),home=page("index");
  const auth=readFileSync(path.join(root,"src/components/auth/AuthPanel.tsx"),"utf8");
  const layout=readFileSync(path.join(root,"src/layouts/Base.astro"),"utf8");
  const pricingSource=readFileSync(path.join(root,"src/pages/pricing.astro"),"utf8");
  // The marketing hero was intentionally removed; verify the real registration form copy instead.
  assert.doesNotMatch(login,/public-inner-hero|auth-hero-visual/);
  assert.match(auth,/验证邮箱完成注册，首次绑定插件可领 200 次免费额度/);
  assert.match(auth,/好友邀请福利：首次绑定插件领 200 次免费额度/);
  assert.match(auth,/成功收到第一条 AI 回复再送 50 次，合计 250 次/);
  assert.match(auth,/Verify your email to register, then get 200 free credits on your first extension connection/);
  assert.match(auth,/Friend invite: get 200 free credits when you first connect the extension/);
  assert.match(auth,/data-registration-email-tip/);
  assert.match(auth,/垃圾邮箱或广告邮件文件夹/);
  assert.match(auth,/data-email-delivery-tip/);
  assert.match(auth,/spam or promotions folder/);
  assert.match(auth,/t\("验证邮箱", "Verify email"\)/);
  assert.doesNotMatch([auth,layout,home,pricingSource].join("\n"),/每个安装实例|One welcome grant per installation|Each installation can claim once|eligible extension installation/);
  assert.match(layout,/signupBenefit\?\.status==="pending"\?"pending"/);
  assert.match(layout,/验证邮箱后，请在插件中连接账户以领取新人额度/);
  assert.match(layout,/Verify your email, then connect your account in the extension to receive welcome credits/);
  assert.match(home,/Create an account, verify your email, then connect your account in the extension to receive welcome credits/);
  assert.match(pricingSource,/验证邮箱后，在插件中连接账户即可领取新人免费额度/);
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
  const loader = readFileSync(path.join(root, "src/lib/account-load.mjs"), "utf8");
  assert.match(source, /loadAccountSnapshot\(api\)/);
  for (const endpoint of ["/v1/me", "/v1/usage", "/v1/activity"]) assert.ok(loader.includes(endpoint), endpoint);
  for (const endpoint of ["/v1/extension/device-code/status", "/v1/extension/approve"]) assert.ok(source.includes(endpoint), endpoint);
  assert.match(source, /error\.status\s*===\s*401/);
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
  assert.match(source, /disabled=\{busy\|\|refreshingOrderId===order\.id\|\|continuingOrderId===order\.id\}/);
  assert.match(source, /diagnostic\.stage/);
  assert.match(api, /diagnostic\?:/);
  assert.match(api, /requestId\?:/);
});
test("checkout after order creation labels the server order snapshot as the exact CNY amount due",()=>{
  const source=readFileSync(path.join(root,"src/pages/checkout.astro"),"utf8");
  assert.match(source,/人民币实付：¥.*next\.amountFen/);
  assert.match(source,/CNY payment due: ¥.*next\.amountFen/);
});
test("MK99 account orders render the actual transaction total and refund copy avoids an unsupported fee promise",()=>{
  const source=readFileSync(path.join(root,"src/components/account/AccountDashboard.tsx"),"utf8");
  assert.match(source,/orderPriceSummary\(order,language\)/);
  assert.match(source,/退款金额将根据订单记录和适用条款核实后处理/);
  assert.doesNotMatch(source,/退款仅退套餐本金，支付服务费原则上不退/);
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

test('privacy policy is public, bilingual and reflects hosted models, retention and manual data requests',()=>{
 const privacy=page('privacy'),feedback=page('feedback');
 for(const text of ['第三方 AI 服务','third-party AI service','Third-party services','third-party payment provider','10 分钟','30 天','reviewed manually','没有账户自助删除功能'])assert.ok(privacy.includes(text),text);
 assert.doesNotMatch(privacy,/隐私政策草案|Draft privacy policy|尚未经过经营者|require review before launch/);
 assert.match(privacy,/href="mailto:zake6678@outlook\.com"/);
 assert.match(privacy,/href="\/feedback\/"/);
 assert.match(feedback,/href="mailto:zake6678@outlook\.com"/);
 assert.match(feedback,/not signed in/);
 assert.doesNotMatch(privacy,/no-reply@|xuyaoyang1@outlook|one-click deletion|DeepSeek|Qwen|Gemini|qwen3|MK99|Cloudflare|Resend|Turnstile/i);
 assert.match(privacy,/data-zh="隐私政策"/);
 assert.match(privacy,/>Privacy Policy<\/h1>/);
 assert.match(privacy,/does not automatically publish X content/);
});


test('public FAQ describes hosted AI without identifying its supplier',()=>{
 const html=page('faq');assert.match(html,/Do I need my own AI API key/);
 assert.doesNotMatch(html,/DeepSeek|Qwen|Gemini|MK99|Resend/i);
});
