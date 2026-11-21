import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAccountState} from '../domain/account-state.js';
import {AccountStateService} from '../services/account-state-service.js';

const sub={status:'active',plan:'pro',dailyLimit:1000,usedToday:237,
  reservedToday:3,remainingToday:760,resetAt:'2026-11-10T09:00:00.000Z',
  expiresAt:'2026-12-09T09:00:00.000Z'};

test('Chrome account state never mixes 24h quota with free and permanent balances',()=>{
 const state=createAccountState({status:'credits_available',
  quota:{freeRemaining:200,paidRemaining:0,totalRemaining:200},subscription:sub},'server');
 assert.equal(state.subscription.plan,'pro');
 assert.equal(state.subscription.remainingToday,760);
 assert.deepEqual(state.quota,{freeRemaining:200,paidRemaining:0,totalRemaining:200});
 assert.equal(state.status,'credits_available');
 assert.equal(Object.isFrozen(state.subscription),true);
 const bad=createAccountState({status:'credits_exhausted',quota:{freeRemaining:0,paidRemaining:0,totalRemaining:0},
   subscription:{...sub,usedToday:1001}},'server');
 assert.equal(bad.subscription,null);
 const disabled=createAccountState({status:'credits_available',quota:{freeRemaining:200,paidRemaining:0,totalRemaining:200}},'server');
 assert.equal(disabled.subscription,null);
});

test('native extension account service retains verified subscription and invalidates stale legacy quota updates',async()=>{
 const fake={
   token:async()=> 'test-token',
   fetchCurrentUser:async()=>({user:{userId:'user1',username:'local'}}),
   fetchEntitlement:async()=>({status:'credits_available',entitlement:{entitlementStatus:'active'}}),
   fetchUsage:async()=>({quota:{freeRemaining:0,paidRemaining:0,totalRemaining:0},subscription:sub})
 };
 const svc=new AccountStateService({config:{hostedApiUrl:'https://test.example'},client:fake});
 const state=await svc.getState();
 assert.equal(state.subscription.remainingToday,760);
 assert.equal(state.status,'credits_available');
 svc.updateServerQuota({totalRemaining:0,freeRemaining:0,paidRemaining:0});
 assert.equal(svc.peekState(),null,'legacy credit update cannot overwrite active subscription entitlement');
 assert.equal((await svc.getState()).subscription.plan,'pro');
});

test('subscription ACK switches to free before paid credits and exhausts only when every bucket is empty',async()=>{
 const owner='user1';
 for(const [freeRemaining,paidRemaining,expected] of [
   [2,0,'credits_available'],
   [0,2,'credits_available'],
   [0,0,'credits_exhausted']
 ]){
   const totalRemaining=freeRemaining+paidRemaining;
   const fake={
     token:async()=> 'test-token',
     fetchCurrentUser:async()=>({user:{userId:owner,username:'local'}}),
     fetchEntitlement:async()=>({status:'credits_available',entitlement:{entitlementStatus:'active'}}),
     fetchUsage:async()=>({quota:{freeRemaining,paidRemaining,totalRemaining},subscription:sub})
   };
   const svc=new AccountStateService({config:{hostedApiUrl:'https://test.example'},client:fake});
   assert.equal((await svc.getState()).status,'credits_available','subscription still usable before final ACK');
   svc.updateServerSubscription({...sub,usedToday:997,reservedToday:3,remainingToday:0},'another-user');
   assert.equal(svc.peekState().subscription.remainingToday,760,'wrong account must not update cached entitlement');
   svc.updateServerSubscription({...sub,usedToday:997,reservedToday:3,remainingToday:0},owner);
   assert.equal(svc.peekState().subscription.remainingToday,0);
   assert.equal(svc.peekState().status,expected,`free=${freeRemaining} paid=${paidRemaining}`);
 }
});

test('exhausted credit side panel shows a real purchase action without misleading payment-disabled copy',()=>{
 const html=readFileSync(new URL('../sidepanel/sidepanel.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../sidepanel/sidepanel.js',import.meta.url),'utf8');
 assert.match(html,/id="purchase-credits"[^>]*>购买永久额度包/);
 assert.match(js,/credits_exhausted'\]\.includes\(status\)/);
 assert.match(js,/status!=='credits_exhausted'\|\|Boolean\(account\?\.pending\)/);
 assert.match(js,/button\.id==='purchase-credits'/);
 assert.match(js,/accountClient\.openWebsite\('\/pricing\/\#permanent-credits'\)/);
 assert.match(js,/生成次数已用完，请购买永久额度包/);
 assert.doesNotMatch(js,/支付暂未开放/);
});

test('side panel visibly separates the subscription daily bucket from paid/free and uses server timestamps',()=>{
 const html=readFileSync(new URL('../sidepanel/sidepanel.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../sidepanel/sidepanel.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../background/service-worker.js',import.meta.url),'utf8');
 for(const id of ['subscription-quota','subscription-plan','subscription-remaining','subscription-daily-limit',
  'subscription-used','subscription-reserved','subscription-reset','subscription-expires','subscription-progress',
  'quota-total','quota-free','quota-paid']){
   assert.ok(html.includes('id="'+id+'"'),id);
 }
 assert.match(html,/id="subscription-quota" class="subscription-quota hidden"/);
 assert.match(html,/先使用订阅.*免费.*永久/);
 assert.match(html,/id="subscription-overage"[^>]+role="status"[^>]+aria-live="polite"/);
 assert.match(html,/id="subscription-overage-text"/);
 assert.match(html,/id="subscription-overage-action"/);
 assert.match(html,/id="subscription-overage-upgrade"/);
 assert.match(js,/subscription-overage-upgrade/);
 assert.match(js,/24\*60\*60\*1000/);
 assert.match(js,/subscription-checkout\/\?upgrade=1&plan=/);
 assert.match(js,/sub\.remainingToday===0/);
 assert.match(js,/accountClient\.openWebsite\('\/pricing\/\#permanent-credits'\)/);
 assert.match(js,/订阅额度已用完.*免费/);
 assert.match(js,/订阅额度.*免费.*用完.*永久/);
 assert.match(js,/account\.subscription\?\.status==='active'/);
 assert.match(js,/sub\.usedToday\+sub\.reservedToday/);
 assert.match(js,/sub\.expiresAt/);
 assert.match(js,/sub\.resetAt/);
 assert.match(js,/原有余额合计/);
 assert.match(worker,/subscription: state\.subscription \?\? null/);
 assert.doesNotMatch(js,/localStorage\.setItem\([^)]*subscription/);
});
