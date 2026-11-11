import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=readFileSync(new URL('../src/components/admin/AdminDashboard.tsx',import.meta.url),'utf8');
const orders=readFileSync(new URL('../src/components/admin/AdminCommercePanel.tsx',import.meta.url),'utf8');
const user=readFileSync(new URL('../src/components/admin/AdminCommerceUserProfile.tsx',import.meta.url),'utf8');

test('Admin orders combine existing credit and subscription business histories without dropping guarded legacy tools',()=>{
 assert.match(root,/AdminCommercePanel active=\{tab==="orders"\}/);
 assert.match(root,/Legacy credit-pack advanced operations/);
 assert.match(root,/selectedOrders/);
 assert.match(root,/\/v1\/admin\/export\?/);
 assert.match(orders,/\/v1\/admin\/commerce\/orders/);
 assert.match(orders,/credit/);assert.match(orders,/subscription/);
 assert.match(orders,/payment_evidence/);
 assert.match(orders,/entitlement_status/);
 assert.match(orders,/nextCursor/);
 assert.match(orders,/AdminCommerceSummary/);
});
test('Financial overview distinguishes real gross payment from mock or legacy and refund caveats',()=>{
 assert.match(root,/AdminCommerceSummary active=\{tab==="overview"\}/);
 assert.match(orders,/\/v1\/admin\/commerce\/summary/);
 assert.match(orders,/Verified provider events only/);
 assert.match(orders,/Subscription refunds require separate verification/);
 assert.match(root,/Credit-pack buyers \(legacy\)/);
});
test('Admin user detail exposes subscription period and permanent entitlement without merging balances',()=>{
 assert.match(root,/AdminCommerceUserProfile userId=\{detail.user.id\}/);
 assert.match(user,/\/v1\/admin\/commerce\/users\//);
 assert.match(user,/subscriptionPeriods/);
 assert.match(user,/subscriptionOrders/);
 assert.match(user,/real_payment_verified/);
 assert.match(user,/creditBalances.paid_balance/);
});
