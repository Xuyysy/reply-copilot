import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(path, "utf8");
const account = read("web/src/components/account/AccountDashboard.tsx");
const layout = read("web/src/layouts/Base.astro");
const auth = read("web/src/components/auth/AuthPanel.tsx");
const css = read("web/src/styles/global.css");

test("account orders are one accessible, collapsed-on-load order center", () => {
  assert.match(account, /<Card data-orders-card/);
  assert.match(account, /t\("订单记录", "Order history"\)/);
  for (const id of ["subscription-orders", "credit-orders"]) {
    const tags = account.match(new RegExp('<details data-'+id+'[^>]*>', "g")) || [];
    assert.equal(tags.length, 1, id + " should only be rendered once");
    assert.doesNotMatch(tags[0], /\bopen(?:=|\s|>)/, "orders must be closed by default");
  }
  assert.match(account, /t\("订阅订单",\s*"Subscription orders"\)/);
  assert.match(account, /t\("充值订单", "Top-up orders"\)/);
  assert.doesNotMatch(account, /最近额度流水|data-activity-scroll|data-activity-retry/);
  assert.equal((account.match(/<Card data-orders-card/g) || []).length, 1);
});

test("hidden order detail preserves payment recovery and entitlement actions", () => {
  for (const token of [
    "subscriptionStatus(order,language)", "核验原订单", "orderPriceSummary(order,language)",
    "continuePayment(order.id)", "refreshPaymentStatus(order.id)",
    "watchPayment", "data-testid=\"account-subscription-quota\"",
    "account-subscription-overage-upgrade"
  ]) assert.ok(account.includes(token), token);
  const subscription = account.indexOf('data-subscription-orders');
  const credit = account.indexOf('data-credit-orders');
  assert.ok(subscription > 0 && credit > subscription);
});

test("header never represents loading or transient quota errors as signed-out", () => {
  assert.match(layout, /id="account-loading"[^>]*role="status"/);
  assert.match(layout, /id="account-entry"[^>]*hidden/);
  assert.match(layout, /id="mobile-account-entry"[^>]*hidden/);
  assert.match(layout, /id="mobile-account-loading"[^>]*role="status"/);
  assert.match(layout, /entry\.hidden=checking\|\|accountState==="error"/);
  assert.match(layout, /mobileEntry\.hidden=checking/);
  assert.match(layout, /await api\("\/v1\/me"\)/);
  assert.match(layout, /accountState="ready";updateAccountLinks\(\)/);
  assert.match(layout, /transient quota error is not evidence/);
  assert.doesNotMatch(layout, /entry\.hidden=false/);
  assert.doesNotMatch(layout, /accountState="loading";updateAccountLinks\(\)/);
  assert.match(css, /#account-entry\[hidden\]/);
  assert.match(css, /#mobile-account-entry\[hidden\]/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});

test("verification codes warn about spam without changing verification APIs", () => {
  assert.equal((auth.match(/data-email-delivery-tip/g) || []).length, 2);
  assert.match(auth, /垃圾邮箱或广告邮件文件夹/);
  assert.match(auth, /spam or promotions folder/);
  assert.match(auth, /\/v1\/auth\/verify-registration/);
  assert.match(auth, /\/v1\/auth\/reset-password/);
});
