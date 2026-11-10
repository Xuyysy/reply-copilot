import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => readFileSync(file, "utf8");
const home = read("web/src/pages/index.astro");

test("creator theory and AI reply preview lead the homepage together", () => {
  const a = home.indexOf('id="creator-momentum"');
  const b = home.indexOf('id="reply-assistant"');
  const c = home.indexOf('id="home-subscriptions"');
  assert.ok(a >= 0 && a < b && b < c);
  for (const token of ["momentum-v2-chart","momentum-v2-reply-module","AI REPLY ASSISTANT",'id="momentum-framework"','data-site-text="homeTitle"',"data-account-cta"]) {
    assert.ok(home.includes(token), token);
  }
});

test("live catalog controls subscription cards and permanently protects credit fallback", () => {
  for (const id of ["home-subscriptions", "home-legacy-pricing"]) {
    assert.equal(home.split('id="' + id + '"').length - 1, 1, id + " must be unique");
  }
  assert.ok(home.includes('id="home-subscriptions" class="section soft" hidden'));
  for (const token of ["/v1/subscriptions/plans","data.autoRenew!==false","data.plans.length>4","homeSubscriptions=data.plans","subscriptionCheckout=data.checkoutAvailable===true","document.getElementById('home-legacy-pricing')!.hidden=true","if(homeSubscriptions){container.hidden=true;return;}","reply-copilot-language',renderHomeSubscriptions","订阅结账尚未开放","永久额度包不主动过期"]) {
    assert.ok(home.includes(token), token);
  }
  assert.ok(!home.includes("无需订阅，也无需自行配置 API Key。"));
  assert.ok(!home.includes("No subscription or personal API key required."));
  assert.ok(home.includes("30 天订阅"));
});

test("public refresh keeps checkout, account and admin implementation unchanged", () => {
  const pricing = read("web/src/pages/pricing.astro");
  const checkout = read("web/src/pages/subscription-checkout.astro");
  const account = read("web/src/pages/account.astro");
  const layout = read("web/src/layouts/Base.astro");
  assert.ok(pricing.includes("/v1/subscriptions/plans"));
  assert.ok(pricing.includes('id="subscription-section"'));
  assert.ok(checkout.includes("SubscriptionCheckout"));
  assert.ok(account.includes("AccountDashboard client:load"));
  assert.ok(layout.includes('"public-refresh": !isAdminPage'));
  assert.ok(!layout.includes("ClientRouter") && !layout.includes("ViewTransitions"));
});
