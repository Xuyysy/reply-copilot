import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');
const admin=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const subscriptions=readFileSync(new URL('../src/components/admin/SubscriptionAdminPanel.tsx',import.meta.url),'utf8');

test('subscription-first website section is strictly gated by trusted catalog, preserves permanent top-ups',()=>{
 assert.match(pricing,/id="subscription-section"[^>]+hidden/);
 assert.match(pricing,/\/v1\/subscriptions\/plans/);
 assert.match(pricing,/result\.autoRenew!==false/);
 assert.match(pricing,/result\.plans\.length!==4/);
 assert.match(pricing,/subscriptionNames\.has\(p\.plan_code\)/);
 assert.match(pricing,/document\.getElementById\('legacy-pricing-hero'\)!\.hidden=true/);
 assert.match(pricing,/['"]\/v1\/packages['"]/);
 assert.match(pricing,/永久额度/);
 assert.match(pricing,/不自动续费/);
 assert.match(pricing,/订阅结账尚未开放，请勿付款/);
 assert.doesNotMatch(pricing,/\/checkout\?subscription=/);
});

test('admin subscription tab is read-only, uses authenticated bounded APIs and shows three quota submetrics',()=>{
 assert.match(admin,/import SubscriptionAdminPanel from '\.\/SubscriptionAdminPanel'/);
 assert.match(admin,/\["subscriptions", t\("订阅管理", "Subscriptions"\)\]/);
 assert.match(admin,/<SubscriptionAdminPanel language=\{language\} active=\{tab==="subscriptions"\}/);
 for(const route of ['/v1/admin/subscriptions/plans','/v1/admin/subscriptions/users'])
   assert.ok(subscriptions.includes(route),route);
 for(const field of ['used_today','reserved_today','remaining_today','order_status','payment_status','effective_status'])
   assert.ok(subscriptions.includes(field),field);
 assert.match(subscriptions,/cause instanceof ApiError && cause\.status===404/);
 assert.match(subscriptions,/unverified records are not active paid entitlements/);
 assert.doesNotMatch(subscriptions,/method\s*:\s*['"]POST['"]/);
 assert.doesNotMatch(subscriptions,/\/v1\/admin\/subscriptions\/(grant|activate|refund|update)/);
});

const account=readFileSync(new URL('../src/components/account/AccountDashboard.tsx',import.meta.url),'utf8');
test('account shows subscription bucket independently with used, reserved, reset and expiry',()=>{
 assert.match(account,/data-testid="account-subscription-quota"/);
 for(const field of ['remainingToday','usedToday','reservedToday','resetAt','expiresAt','dailyLimit'])
   assert.ok(account.includes('usage.subscription.'+field),field);
 assert.match(account,/aria-valuenow=\{usage.subscription.usedToday\+usage.subscription.reservedToday\}/);
 assert.match(account,/usage.subscription\?\.status==="active"/);
 assert.match(account,/原有免费及永久次数/);
 assert.match(account,/升档和续购结账尚未开放/);
});

const home=readFileSync(new URL('../src/pages/index.astro',import.meta.url),'utf8');
test('homepage swaps credit-first to subscription-first only after valid server catalog',()=>{
 assert.match(home,/id="home-subscriptions"[^>]*hidden/);
 assert.match(home,/id="home-legacy-pricing"/);
 assert.match(home,/\/v1\/subscriptions\/plans/);
 assert.match(home,/homeSubscriptions=data.plans/);
 assert.match(home,/document\.getElementById\('home-legacy-pricing'\)!\.hidden=true/);
 assert.match(home,/if\(homeSubscriptions\)\{container\.hidden=true;return;\}/);
 assert.match(home,/订阅结账尚未开放/);
 assert.match(home,/reply-copilot-language',renderHomeSubscriptions/);
});
