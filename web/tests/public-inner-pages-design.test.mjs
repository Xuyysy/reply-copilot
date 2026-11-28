import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(file, "utf8");

test("public inner pages share the Chrome extension's branded responsive layout", () => {
  const css = source("web/src/styles/global.css");
  const layout = source("web/src/layouts/Base.astro");
  for (const name of ["guide", "faq", "feedback"]) {
    const page = source(`web/src/pages/${name}.astro`);
    assert.match(page, /class="container public-inner-hero /, `${name} needs the public hero`);
    assert.match(page, /public-hero-visual/, `${name} needs the branded supporting illustration`);
  }
  assert.match(css, /\.public-refresh \.public-inner-hero \{/);
  assert.match(css, /\.public-refresh \.public-faq-item/);
  assert.match(css, /@media\(max-width:520px\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(layout, /"public-refresh": !isAdminPage/);
});

test("live account, login and feedback flows remain mounted, not rewritten", () => {
  const login = source("web/src/pages/login.astro");
  const account = source("web/src/pages/account.astro");
  const feedback = source("web/src/pages/feedback.astro");
  assert.match(login, /<AuthPanel client:load localVerification=\{localVerification\} sitekey=\{sitekey\} \/>/);
  assert.match(login, /<script is:inline data-xrh-turnstile/);
  assert.match(login, /id="auth-load-error"/);
  assert.match(account, /<AccountDashboard client:load \/>/);
  assert.match(feedback, /id="feedback-form"/);
  assert.match(feedback, /api\("\/v1\/feedback"/);
  assert.match(feedback, /mailto:zake6678@outlook\.com/);
});

test("guide keeps CMS-controlled links and FAQ keeps CMS fallback", () => {
  const guide = source("web/src/pages/guide.astro");
  const faq = source("web/src/pages/faq.astro");
  assert.match(guide, /data-site-text="guideTitle"/);
  assert.match(guide, /data-site-text="guide"/);
  assert.match(guide, /data-site-link="chromeStoreUrl"/);
  assert.match(guide, /data-site-link="xTutorialUrl"/);
  assert.match(guide, /id="guide-steps-heading"/);
  assert.match(faq, /data-site-text="faq"/);
  assert.match(faq, /data-site-faq-default/);
  assert.equal((faq.match(/<details class="faq-item/g) || []).length, 4);
  assert.equal((faq.match(/<\/details>/g) || []).length, 4);
  assert.match(faq, /href="\/feedback"/);
  assert.match(faq, /data-zh="免费额度何时领取？"/);
  assert.match(faq, /data-zh="一次生成三种风格扣几次？"/);
  assert.match(faq, /data-zh="会自动发送 X 回复吗？"/);
  assert.match(faq, /data-zh="没有出现悬浮窗？"/);
  assert.match(faq, /刷新 X 官网（x\.com）页面/);
  assert.match(faq, /不要使用 Google 网页翻译/);
  assert.match(faq, /restore the original page, and refresh/);
  assert.doesNotMatch(faq, /需要自己的 AI API Key 吗|如何充值？|在哪里反馈问题？/);
  assert.deepEqual([...faq.matchAll(/class="faq-number">(\d+)<\/span>/g)].map(m=>m[1]),["01","02","03","04"]);
});

test("auth and account pages go straight to functional panels without duplicate marketing heroes", () => {
  const login = source("web/src/pages/login.astro");
  const account = source("web/src/pages/account.astro");
  assert.doesNotMatch(login, /public-inner-hero|auth-hero-visual|public-hero-points/);
  assert.doesNotMatch(account, /public-inner-hero|account-hero-visual|public-hero-points|public-panel-heading/);
  assert.match(login, /class="container public-auth-panel-wrap app-shell"/);
  assert.match(account, /class="container public-account-panel app-shell"/);
  const auth = source("web/src/components/auth/AuthPanel.tsx");
  assert.equal((auth.match(/data-email-delivery-tip/g) || []).length, 2);
  assert.match(auth, /垃圾邮箱或广告邮件文件夹/);
  assert.match(auth, /spam or promotions folder/);
});
