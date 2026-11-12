import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {subscriptionPricingChoices,UPGRADE_MIN_REMAINING_MS} from '../src/lib/subscription-pricing-choices.mjs';

const now=Date.parse('2026-11-12T08:00:00Z');
const full={targetPlan:'pro',buyerStatus:'active',currentPlan:'basic',expiresAt:new Date(now+15*86400000).toISOString(),now};
const decisions=value=>subscriptionPricingChoices({...full,...value});

test('a BASIC subscriber is offered an explicit prorated current-period upgrade and a distinct full-price PRO next period',()=>{
 const result=decisions({});
 assert.equal(result.mode,'upgrade_available');
 assert.deepEqual(result.actions,[
  {kind:'upgrade',href:'/subscription-checkout/?plan=pro&upgrade=1'},
  {kind:'next',href:'/subscription-checkout/?plan=pro'},
 ]);
 assert.equal(result.actions.filter(x=>x.kind==='upgrade').length,1);
});
test('no upgrade is offered in final 24 hours, at or below current tier, or with invalid period',()=>{
 assert.equal(decisions({expiresAt:new Date(now+UPGRADE_MIN_REMAINING_MS-1).toISOString()}).mode,'upgrade_final_day');
 assert.deepEqual(decisions({expiresAt:new Date(now+UPGRADE_MIN_REMAINING_MS-1).toISOString()}).actions.map(x=>x.kind),['next']);
 assert.equal(decisions({expiresAt:new Date(now+UPGRADE_MIN_REMAINING_MS).toISOString()}).mode,'upgrade_available');
 assert.equal(decisions({targetPlan:'basic'}).mode,'renew_same');
 assert.equal(decisions({currentPlan:'pro',targetPlan:'basic'}).mode,'change_next');
 assert.equal(decisions({expiresAt:new Date(now).toISOString()}).mode,'unavailable');
 assert.equal(decisions({expiresAt:'not-a-date'}).mode,'unavailable');
});
test('new customers see first purchase, while signed-out customers are not promised an upgrade',()=>{
 assert.deepEqual(decisions({buyerStatus:'none'}),{mode:'purchase',actions:[{kind:'purchase',href:'/subscription-checkout/?plan=pro'}]});
 assert.deepEqual(decisions({buyerStatus:'guest'}),{mode:'guest',actions:[{kind:'purchase',href:'/subscription-checkout/?plan=pro'}]});
 assert.deepEqual(decisions({buyerStatus:'loading'}),{mode:'loading',actions:[]});
 assert.deepEqual(decisions({buyerStatus:'unavailable'}),{mode:'unavailable',actions:[{kind:'account',href:'/account/'}]});
});
test('unresolved paid or uncertain orders take priority: only original-order recovery is available',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const result=decisions({pendingOrderId:id});
 assert.deepEqual(result,{mode:'pending',actions:[{kind:'original',href:'/subscription-checkout/?order='+id}]});
 assert.equal(decisions({queuedOrderId:id}).mode,'queued');
 assert.equal(decisions({pendingOrderId:id,queuedOrderId:id}).mode,'pending');
 assert.equal(decisions({buyerStatus:'none',pendingOrderId:id}).mode,'pending');
});
test('pricing page fetches server-owned subscriber status and orders; checkout requires explicit upgrade quote',()=>{
 const pricing=readFileSync(new URL('../src/pages/pricing.astro',import.meta.url),'utf8');
 const checkout=readFileSync(new URL('../src/components/account/SubscriptionCheckout.tsx',import.meta.url),'utf8');
 for(const marker of [
  "subscriptionPricingChoices","/v1/usage","/v1/subscriptions/orders","待核验的原订单",
  "本期升档 · 获取补差价报价","购买下一期 · 全价 ¥","当前订阅不会立即变更"
 ])assert.ok(pricing.includes(marker),marker);
 assert.ok(checkout.includes('&upgrade=1'));
 assert.ok(checkout.includes("quoteId:quote?.id"));
 assert.ok(checkout.includes("本期剩余不足 24 小时"));
 assert.ok(checkout.includes("按完整价格购买下一期"));
 assert.equal(pricing.includes("buy.textContent=txt('购买或续购'"),false);
});
