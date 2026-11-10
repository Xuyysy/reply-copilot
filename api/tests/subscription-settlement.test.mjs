import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,withProvider} from './helpers/payment-v2.mjs';

const merchant='20881234567890';
function ready(){
 const f=fixture();
 Object.assign(f.env,{
  SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',
  MK99_PID:merchant,MK99_KEY:'test-only-not-a-live-merchant-key',
  MK99_REQUEST_SIGN_TYPE:'MD5',MK99_NOTIFY_SIGN_TYPE:'MD5',
  MK99_PROTOCOL_CONFIRMED:'1',MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL'
 });
 return f;
}
function seed(f,id='sub-order-1',{plan='basic',kind='purchase',userId='test-user',targetPeriod=null}={}){
 const amounts={basic:6990,pro:11990,max:17990,ultra:25990};
 const amount=amounts[plan],trade='SUB_'+id;
 f.sql.prepare(`INSERT INTO subscription_orders
  (id,user_id,plan_version_id,kind,target_period_id,amount_fen,status,
   quoted_at,quote_expires_at,created_at,updated_at)
  VALUES(?,?,?,?,?,?,'pending',1,9999999999999,1,1)`)
  .run(id,userId,plan+'-v1',kind,targetPeriod,amount);
 f.sql.prepare(`INSERT INTO subscription_payment_transactions
  (id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,
   amount_fen,notification_sign_type,status,created_at,updated_at)
  VALUES(? ,?,'mk99',? ,?,'ALIPAY_H5',?,'MD5','pending',1,1)`)
  .run('txn-'+id,id,merchant,trade,amount);
 return {id,trade,amount};
}
async function query(f,id,options={}){
 const count={calls:0};
 const result=await withProvider(request=>{
   count.calls++;
   const params=new URLSearchParams(request.body);
   assert.equal(params.get('out_trade_no'),'SUB_'+id);
   assert.equal(new URL(request.url).origin,'https://mk99.cn');
   const amount=options.amount??'69.90';
   return Response.json({code:1,data:{
     out_trade_no:options.outTradeNo??params.get('out_trade_no'),
     trade_no:options.tradeNo??'MK99_TRADE_'+id,
     trade_status:options.status??'TRADE_SUCCESS',total_amount:amount,
     pid:options.pid??merchant,paytype_code:options.paytype??'alipay',currency:'CNY'
   }});
 },()=>f.call('/v1/subscriptions/orders/'+id+'/refresh',{method:'POST'}));
 return {...result,calls:count.calls};
}
function counts(f){
 const q=x=>f.sql.prepare('SELECT count(*) n FROM '+x).get().n;
 return {periods:q('subscription_periods'),events:q('subscription_payment_events'),
   creditGrants:q('credit_grants'),legacyOrders:q('recharge_orders'),paid:f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance};
}

test('real query proof atomically grants one 30-day subscription without issuing permanent credits',async()=>{
 const f=ready();
 try{
  seed(f);
  const r=await query(f,'sub-order-1');
  assert.equal(r.calls,1);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.orderStatus,'paid');
  assert.equal(r.body.paymentConfirmed,true);
  assert.equal(r.body.period.status,'active');
  assert.equal(r.body.period.daily_limit,500);
  assert.equal(r.body.period.end_at-r.body.period.start_at,30*86400000);
  assert.deepEqual(counts(f),{periods:1,events:1,creditGrants:0,legacyOrders:0,paid:0});
  const event=f.sql.prepare("SELECT event_type,body_sha256,merchant_provider FROM subscription_payment_events").get();
  assert.equal(event.event_type,'PAYMENT_SUCCEEDED');
  assert.match(event.body_sha256,/^[a-f0-9]{64}$/);
  assert.equal(event.merchant_provider,'mk99');
  const account=await f.call('/v1/usage',{method:'GET'});
  assert.equal(account.body.subscription.status,'active');
  assert.equal(account.body.subscription.remainingToday,500);
 }finally{f.sql.close();}
});

test('retrying authenticated MK99 confirmation never creates another period or money grant',async()=>{
 const f=ready();
 try{
  seed(f);
  const a=await query(f,'sub-order-1'),b=await query(f,'sub-order-1');
  assert.equal(a.status,200);
  assert.equal(b.status,200,JSON.stringify(b.body));
  assert.equal(b.body.period.id,a.body.period.id);
  assert.deepEqual(counts(f),{periods:1,events:1,creditGrants:0,legacyOrders:0,paid:0});
 }finally{f.sql.close();}
});

test('second paid renewal queues behind active period rather than stacking same-day 500+1000',async()=>{
 const f=ready();
 try{
  seed(f);
  assert.equal((await query(f,'sub-order-1')).status,200);
  seed(f,'sub-order-2',{plan:'pro',kind:'renewal'});
  const r=await query(f,'sub-order-2',{amount:'119.90'});
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.period.status,'queued');
  assert.equal(r.body.period.start_at,null);
  assert.equal(r.body.period.end_at,null);
  const status=await f.call('/v1/usage',{method:'GET'});
  assert.equal(status.body.subscription.dailyLimit,500);
  assert.equal(status.body.subscription.plan,'basic');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_periods WHERE status='active'").get().n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_periods WHERE status='queued'").get().n,1);
  assert.deepEqual(counts(f),{periods:2,events:2,creditGrants:0,legacyOrders:0,paid:0});
 }finally{f.sql.close();}
});

test('wrong amount, merchant, trade or payment channel cannot grant subscriptions',async()=>{
 for(const options of [{amount:'0.01'},{pid:'20880000000'},{tradeNo:'INVALID'},{outTradeNo:'OTHER_TXN'},{paytype:'wxpay'}]){
  const f=ready();
  try{
   seed(f);
   // The provider trade number is unknown before first trusted confirmation.
   // A mismatch is only invalid if this order has ALREADY pinned a different
   // MK99 transaction. Never reject a valid first query just for its ID.
   if(options.tradeNo)f.sql.prepare("UPDATE subscription_payment_transactions SET provider_payment_id=? WHERE order_id='sub-order-1'").run('MK99_ALREADY_PINNED');
   const r=await query(f,'sub-order-1',options);
   assert.notEqual(r.status,200,JSON.stringify(options));
   assert.equal(counts(f).periods,0);
   assert.equal(counts(f).events,0);
   assert.equal(counts(f).paid,0);
  }finally{f.sql.close();}
 }
});

test('provider pending, refund, frozen and closed never auto-grant a subscription',async()=>{
 for(const status of ['WAIT_BUYER_PAY','TRADE_REFUND','TRADE_FREEZE','TRADE_CLOSED']){
  const f=ready();
  try{
   seed(f);const r=await query(f,'sub-order-1',{status});
   assert.equal(r.status,200);
   assert.equal(r.body.paymentConfirmed,false);
   assert.equal(counts(f).periods,0);
   assert.equal(counts(f).events,['TRADE_REFUND','TRADE_FREEZE'].includes(status)?1:0);
  }finally{f.sql.close();}
 }
});

test('disabled switches and wrong owner prevent queries; risk-held payments cannot grant',async()=>{
 const f=ready();
 try{
  seed(f);
  f.env.SUBSCRIPTION_PURCHASES_ENABLED='0';
  let r=await query(f,'sub-order-1');
  assert.equal(r.status,404);assert.equal(r.calls,0);
  f.env.SUBSCRIPTION_PURCHASES_ENABLED='1';
  f.sql.exec("UPDATE subscription_payment_transactions SET risk_state='manual_review'");
  r=await query(f,'sub-order-1');
  assert.equal(r.status,200);assert.equal(r.body.entitlementApplied,false);assert.equal(counts(f).periods,0);
  f.sql.exec("UPDATE subscription_payment_transactions SET risk_state='clear'");
  f.sql.prepare("INSERT INTO users(id,email,email_verified_at,created_at) VALUES('other','other@example.test',1,1)").run();
  seed(f,'other-order',{userId:'other'});
  r=await query(f,'other-order');
  assert.equal(r.status,404);assert.equal(r.calls,0);
 }finally{f.sql.close();}
});

test('upgrade order is not mistaken for a new 30-day purchase',async()=>{
 const f=ready();
 try{
  seed(f);assert.equal((await query(f,'sub-order-1')).status,200);
  const existing=f.sql.prepare("SELECT id FROM subscription_periods WHERE source_order_id='sub-order-1'").get().id;
  seed(f,'upgrade-one',{plan:'pro',kind:'upgrade',targetPeriod:existing});
  const r=await query(f,'upgrade-one',{amount:'119.90'});
  assert.equal(r.status,409);
  assert.equal(counts(f).periods,1);
 }finally{f.sql.close();}
});

test('archived account cannot gain a subscription from a late provider success',async()=>{
 const f=ready();
 try{
  seed(f);
  f.sql.exec("UPDATE users SET archived_at=1000 WHERE id='test-user'");
  const r=await query(f,'sub-order-1');
  assert.notEqual(r.status,200);
  assert.deepEqual(counts(f),{periods:0,events:0,creditGrants:0,legacyOrders:0,paid:0});
  assert.equal(f.sql.prepare("SELECT status FROM subscription_orders WHERE id='sub-order-1'").get().status,'pending');
 }finally{f.sql.close();}
});

test('query replay after an expired 30-day period never reopens the same paid order',async()=>{
 const f=ready();
 try{
  seed(f);
  assert.equal((await query(f,'sub-order-1')).status,200);
  f.sql.exec("UPDATE subscription_periods SET start_at=1,end_at=2592000001 WHERE source_order_id='sub-order-1'");
  const r=await query(f,'sub-order-1');
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.equal(r.body.period.status,'expired');
  assert.equal(r.body.period.start_at,1);
  assert.equal(r.body.period.end_at,2592000001);
  assert.deepEqual(counts(f),{periods:1,events:1,creditGrants:0,legacyOrders:0,paid:0});
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
 }finally{f.sql.close();}
});
