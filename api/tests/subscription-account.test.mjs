import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/payment-v2.mjs';

const DAY=86400000,PERIOD=30*DAY;
const usage=async f=>(await f.call('/v1/usage',{method:'GET'}));
const entitlements=async f=>(await f.call('/v1/entitlements',{method:'GET'}));
const momentum=async f=>(await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'}));

function seedPeriod(f,{now=Date.now(),plan='pro',used=230,reserved=3,validEvent=true}={}){
 const start=now-2*DAY+12345,end=start+PERIOD;
 const prices={basic:6990,pro:11990,max:17990,ultra:25990};
 const limits={basic:500,pro:1000,max:1500,ultra:2000};
 f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('order-sub','test-user',?,'purchase',?,'paid',1,10000000000000,1,1,?,?)")
   .run(plan+'-v1',prices[plan],now,now);
 f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,provider_trade_id,payment_channel,amount_fen,status,risk_state,created_at,updated_at,paid_at) VALUES('txn-sub','order-sub','local_mock','sub-trade','LOCAL_MOCK',?,'paid','clear',1,1,?)")
   .run(prices[plan],now);
 if(validEvent)f.sql.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('event-sub','txn-sub','local_mock','verified-sub-event','PAYMENT_SUCCEEDED',?,?)").run(prices[plan],now);
 f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('period-sub','test-user','order-sub',? ,?,'active',?,?,1,1)")
   .run(plan+'-v1',limits[plan],start,end);
 f.sql.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES('period-sub',2,?,?,?)")
   .run(used,reserved,now);
 return {start,end,now,limits};
}

test('disabled subscription flag preserves legacy quota and eligibility and makes no hidden grant',async()=>{
 const f=fixture();
 try{
   seedPeriod(f);
   const r=await usage(f);
   assert.equal(r.status,200);
   assert.equal(r.body.subscription.status,'none');
   assert.equal(r.body.subscription.remainingToday,0);
   assert.deepEqual(r.body.quota,{freeRemaining:200,paidRemaining:0,totalRemaining:200});
   assert.equal(r.body.availableNow,200);
   assert.equal((await momentum(f)).body.features.interactionMomentum.eligible,false);
 }finally{f.sql.close();}
});

test('active proof exposes separate subscription daily quota without changing paid/free balances',async()=>{
 const f=fixture();
 try{
   f.env.SUBSCRIPTIONS_ENABLED='1';
   const {start,end}=seedPeriod(f,{plan:'pro',used:230,reserved:3});
   const r=await usage(f);
   assert.equal(r.status,200,JSON.stringify(r.body));
   assert.deepEqual(r.body.quota,{freeRemaining:200,paidRemaining:0,totalRemaining:200});
   assert.equal(r.body.subscription.status,'active');
   assert.equal(r.body.subscription.plan,'pro');
   assert.equal(r.body.subscription.dailyLimit,1000);
   assert.equal(r.body.subscription.usedToday,230);
   assert.equal(r.body.subscription.reservedToday,3);
   assert.equal(r.body.subscription.remainingToday,767);
   assert.equal(r.body.subscription.expiresAt,new Date(end).toISOString());
   assert.equal(r.body.subscription.resetAt,new Date(start+3*DAY).toISOString());
   assert.equal(r.body.availableNow,767);
   const e=await entitlements(f);
   assert.equal(e.body.status,'credits_available');
   assert.equal(e.body.subscription.plan,'pro');
   assert.equal(e.body.availableNow,767);
   assert.equal((await momentum(f)).body.features.interactionMomentum.eligible,true);
   assert.equal(f.sql.prepare("SELECT free_balance,paid_balance FROM credit_accounts WHERE user_id='test-user'").get().free_balance,200);
 }finally{f.sql.close();}
});

test('subscription does not use leftover welcome freebies after the daily cap is consumed',async()=>{
 const f=fixture();
 try{
   f.env.SUBSCRIPTIONS_ENABLED='1';
   seedPeriod(f,{plan:'basic',used:500,reserved:0});
   const r=await usage(f),e=await entitlements(f);
   assert.equal(r.body.subscription.remainingToday,0);
   assert.equal(r.body.quota.freeRemaining,200);
   assert.equal(r.body.availableNow,0);
   assert.equal(e.body.status,'credits_exhausted');
   assert.equal((await momentum(f)).body.features.interactionMomentum.eligible,true);
 }finally{f.sql.close();}
});

test('subscription cannot be granted from an unverified order event or refund risk',async()=>{
 const f=fixture();
 try{
   f.env.SUBSCRIPTIONS_ENABLED='1';
   seedPeriod(f,{validEvent:false});
   assert.equal((await usage(f)).body.subscription.status,'none');
   assert.equal((await momentum(f)).body.features.interactionMomentum.eligible,false);
   f.sql.prepare("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,received_at) VALUES('event-sub','txn-sub','local_mock','verified-sub-event','PAYMENT_SUCCEEDED',11990,1)").run();
   assert.equal((await usage(f)).body.subscription.status,'active');
   f.sql.exec("UPDATE subscription_payment_transactions SET risk_state='manual_review'");
   assert.equal((await usage(f)).body.subscription.status,'none');
   f.sql.exec("UPDATE subscription_payment_transactions SET risk_state='clear',status='refunded'");
   assert.equal((await momentum(f)).body.features.interactionMomentum.eligible,false);
 }finally{f.sql.close();}
});

test('frozen user or expired active row grants no subscription and no Creator Momentum',async()=>{
 const f=fixture();
 try{
   f.env.SUBSCRIPTIONS_ENABLED='1';
   seedPeriod(f);
   f.sql.exec("UPDATE users SET status='frozen' WHERE id='test-user'");
   assert.equal((await usage(f)).body.subscription.status,'none');
   assert.equal((await momentum(f)).body.features.interactionMomentum.eligible,false);
   f.sql.exec("UPDATE users SET status='active'; UPDATE subscription_periods SET start_at=1,end_at=2592000001");
   assert.equal((await usage(f)).body.subscription.status,'none');
 }finally{f.sql.close();}
});

test('invalid overdrawn subscription usage fails closed instead of reporting extra quota',async()=>{
 const f=fixture();
 try{
   f.env.SUBSCRIPTIONS_ENABLED='1';
   seedPeriod(f,{plan:'basic',used:500,reserved:1});
   const r=await usage(f);
   assert.equal(r.status,503);
   assert.equal(r.body.code,'SUBSCRIPTION_USAGE_INVALID');
 }finally{f.sql.close();}
});
