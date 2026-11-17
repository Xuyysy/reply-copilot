import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const account=read("../src/components/account/AccountDashboard.tsx");
const bolt=read("../src/components/account/AccountBoltOrder.tsx");
const checkout=read("../src/components/account/SubscriptionCheckout.tsx");

test("subscription and credit histories each have one shared order list, without duplicate USDT subsection",()=>{
 assert.equal((account.match(/<details data-subscription-orders/g)||[]).length,1);
 assert.equal((account.match(/<details data-credit-orders/g)||[]).length,1);
 assert.doesNotMatch(account,/<BoltOrdersList/);
 assert.match(account,/boltOrders\.filter\(o=>o\.productType==="subscription"\)\.map/);
 assert.match(account,/b\.creditOrderId===order\.id/);
 assert.match(account,/creditBoltExtras\.map\(order=>/);
 assert.match(account,/BoltPaymentBadge order=\{bolt\}/);
 assert.match(account,/subscriptionStatus\(order,language\)/);
 assert.match(account,/orderPriceSummary\(order,language\)/);
 assert.match(account,/refreshPaymentStatus\(order\.id\)/);
});

test("one USDT invoice is shown in the native credit row; unmatched historical invoices are not dropped",()=>{
 assert.match(account,/creditBoltExtras=boltOrders\.filter\(order=>order\.productType==="credits"&&/);
 assert.match(account,/!data\?\.activity\?\.orders\.some\(row=>row\.id===order\.creditOrderId\)/);
 assert.match(account,/bolt\?\(bolt\.amount\?\?bolt\.quotedAmount\)\+" USDT"/);
 assert.match(account,/bolt\?boltPaymentStatus\(bolt,language\)/);
 assert.doesNotMatch(account,/t\("USDT 充值订单"/);
 assert.doesNotMatch(account,/t\("USDT 订阅订单"/);
});

test("finished USDT orders are labels only, while pending invoices retain payment and cancellation controls",()=>{
 assert.match(bolt,/const pending=order\.status==="pending"\|\|order\.status==="unknown"/);
 assert.match(bolt,/canContinue&&<Button/);
 assert.match(bolt,/pending&&<Button/);
 assert.match(bolt,/order\.status==="closed"&&<Button/);
 assert.doesNotMatch(bolt,/order\.status==="paid"&&<Button/);
 assert.match(account,/\/v1\/boltutil\/orders\/"\+encodeURIComponent\(order\.id\)\+"\/cancel"/);
 assert.match(account,/if\(!window\.confirm\(t\(/);
 assert.match(checkout,/actionableUnpaidUsdtConflict/);
 assert.match(checkout,/className="button mt-4 w-full sm:w-auto"/);
});

test("redundant lower account pricing CTA card is removed without removing the pricing navigation",()=>{
 assert.doesNotMatch(account,/t\("按需充值", "Top up when needed"\)/);
 assert.doesNotMatch(account,/t\("查看套餐", "View plans"\)/);
 assert.match(account,/href="\/pricing"/);
});
