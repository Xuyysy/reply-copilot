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
 assert.match(pricing,/result\.plans\.length>4/);
 assert.match(pricing,/subscriptionNames\.has\(p\.plan_code\)/);
 assert.match(pricing,/document\.getElementById\('legacy-pricing-hero'\)!\.hidden=true/);
 assert.match(pricing,/['"]\/v1\/packages['"]/);
 assert.match(pricing,/永久额度/);
 assert.match(pricing,/不自动续费/);
 assert.match(pricing,/订阅结账尚未开放，请勿付款/);
 assert.doesNotMatch(pricing,/\/checkout\?subscription=/);
});

test('admin subscription tab uses bounded APIs, shared write confirmation and three quota submetrics',()=>{
 assert.match(admin,/import SubscriptionAdminPanel from '\.\/SubscriptionAdminPanel'/);
 assert.ok(admin.includes('["subscriptions",t("订阅高级管理","Subscription controls")]'));
 assert.match(admin,/<SubscriptionAdminPanel language=\{language\} active=\{tab==="subscriptions"\}/);
 for(const route of ['/v1/admin/subscriptions/plans','/v1/admin/subscriptions/users'])
   assert.ok(subscriptions.includes(route),route);
 for(const field of ['used_today','reserved_today','remaining_today','order_status','payment_status','effective_status'])
   assert.ok(subscriptions.includes(field),field);
 assert.match(subscriptions,/cause instanceof ApiError && cause\.status===404/);
 assert.match(subscriptions,/unverified records are not active paid entitlements/);
 assert.match(subscriptions,/confirm\(t\('发布套餐新版本'/);
 assert.match(subscriptions,/write\('\/v1\/admin\/subscriptions\/plans\/'/);
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
 assert.match(account,/购买下一期/);
 assert.match(account,/查看原订单/);
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

const creditCheckout=readFileSync(new URL('../src/pages/checkout.astro',import.meta.url),'utf8');
test('pricing and checkout distinguish 30-day daily subscriptions from permanent one-time credit packs in both languages',()=>{
 // Subscription rules stay 30 days with no rollover; prepaid overage is explicitly separate.
 for(const marker of ['30 天订阅','每 24 小时重置','未使用的日额度不累计','永久额度包','不主动过期','订阅当天额度用完','未订阅也能单独购买'])
   assert.ok(pricing.includes(marker),'pricing missing '+marker);
 assert.match(pricing,/id="permanent-credits"/);
 assert.match(pricing,/id="packages"/);
 assert.match(pricing,/购买或续购/);
 assert.match(pricing,/查看额度包/);
 assert.match(pricing,/Permanent credit packs/);
 assert.match(pricing,/Unused daily allowance does not roll over/);
 assert.match(pricing,/One-time purchase/);
 assert.match(creditCheckout,/永久额度包结账/);
 assert.match(creditCheckout,/额度包不按天清零/);
 assert.match(creditCheckout,/Permanent credit pack checkout/);
 assert.match(account,/永久付费额度/);
 assert.match(account,/订阅.*免费.*永久/);
 assert.match(account,/role="status"[^>]*data-testid="account-subscription-overage"/);
 assert.match(account,/今日订阅额度已用完/);
 assert.match(account,/免费额度.*永久/);
 assert.match(account,/account-subscription-overage-upgrade/);
 assert.match(account,/今日订阅额度已用完/);
 assert.match(account,/升级订阅/);
 assert.match(account,/24\*60\*60\*1000/);
 assert.match(pricing,/订阅.*免费.*永久/);
 assert.match(home,/免费.*永久/);
 assert.match(home,/永久额度包不主动过期/);
});
