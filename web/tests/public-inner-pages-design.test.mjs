import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (file) => readFileSync(file, "utf8");

test("public inner pages share the Chrome extension's branded responsive layout", () => {
  const css = source("web/src/styles/global.css");
  const layout = source("web/src/layouts/Base.astro");
  for (const name of ["guide", "login", "account", "faq", "feedback"]) {
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
  assert.equal((faq.match(/<details class="faq-item/g) || []).length, 6);
  assert.equal((faq.match(/<\/details>/g) || []).length, 6);
  assert.match(faq, /href="\/feedback"/);
  assert.match(faq, /data-zh="免费额度何时领取？"/);
});
