import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,withProvider,providerResponse } from './helpers/payment-v2.mjs';

const req=(key='xd-subscription-0001',planCode='basic',channel='ALIPAY_H5')=>({idempotencyKey:key,planCode,channel});
function ready(){
 const f=fixture({released:false});
 Object.assign(f.env,{SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',SUBSCRIPTION_CHECKOUT_ENABLED:'1'});
 f.sql.exec("UPDATE system_settings SET value='xiaodou' WHERE key='active_merchant'");
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_enabled','payment_rsa2_alipay_enabled','payment_rsa2_alipay_released')");
 return f;
}
async function create(f,body=req(),response={}){
 return await withProvider(r=>{
  assert.equal(new URL(r.url).pathname,'/api/open/v1/payments');
  assert.equal(r.method,'POST');
  const data=JSON.parse(r.body);
  assert.equal(data.channel,'ALIPAY_H5');
  assert.equal(data.amountFen,body.planCode==='pro'?11990:6990);
  assert.equal(data.currency,'CNY');
  assert.equal(data.returnUrl,'https://staging.example.test/subscription-checkout/');
  assert.ok(!Object.hasOwn(data,'notifyUrl'));
  return providerResponse(r,{outTradeNo:data.outTradeNo,amountFen:data.amountFen,channel:'ALIPAY_H5',
    openOrderId:'xd-open-order-0001',payUrl:'https://cashier.example.test/pay/xd',...response});
 },()=>f.call('/v1/subscriptions/orders',{body}));
}
async function query(f,orderId,fields={}){
 const trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(orderId).provider_trade_id;
 return withProvider(r=>{
   assert.equal(r.method,'GET');
   assert.equal(new URL(r.url).pathname,'/api/open/v1/payments/'+trade);
   return providerResponse(r,{outTradeNo:trade,amountFen:6990,currency:'CNY',channel:'ALIPAY_H5',
     status:'SUCCEEDED',openOrderId:'xd-open-order-0001',payUrl:null,...fields},{status:200});
 },()=>f.call('/v1/subscriptions/orders/'+orderId+'/refresh',{body:{}}));
}
const metrics=f=>({
 subscriptionOrders:f.sql.prepare('SELECT count(*) n FROM subscription_orders').get().n,
 events:f.sql.prepare('SELECT count(*) n FROM subscription_payment_events').get().n,
 periods:f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,
 credits:f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,
 packageOrders:f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n
});

test('Xiaodou RSA2 Alipay creates a subscription order without granting any entitlement',async()=>{
 const f=ready();
 try{
  const r=await create(f);
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.order.checkout.outcome,'ready');
  assert.equal(r.body.order.checkout.paymentConfirmed,false);
  assert.equal(r.body.order.checkout.paymentUrl,'https://cashier.example.test/pay/xd');
  const t=f.sql.prepare('SELECT merchant_provider,merchant_account,notification_sign_type,payment_channel,checkout_state FROM subscription_payment_transactions').get();
  assert.equal(t.merchant_provider,'xiaodou');
  assert.equal(t.merchant_account,f.env.XIAODOU_APP_ID);
  assert.equal(t.notification_sign_type,f.env.XIAODOU_KEY_ID);
  assert.equal(t.payment_channel,'ALIPAY_H5');
  assert.equal(t.checkout_state,'ready');
  assert.deepEqual(metrics(f),{subscriptionOrders:1,events:0,periods:0,credits:0,packageOrders:0});
 }finally{f.sql.close();}
});

test('Xiaodou signed query grants one subscription even after new merchant switches to MK99',async()=>{
 const f=ready();
 try{
  const r=await create(f);
  assert.equal(r.status,201,JSON.stringify(r.body));
  const id=r.body.order.id;
  f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
  const a=await query(f,id);
  assert.equal(a.status,200,JSON.stringify(a.body));
  assert.equal(a.body.orderStatus,'paid');
  assert.equal(a.body.paymentConfirmed,true);
  assert.equal(a.body.entitlementApplied,true);
  assert.deepEqual(metrics(f),{subscriptionOrders:1,events:1,periods:1,credits:0,packageOrders:0});
  const b=await query(f,id);
  assert.equal(b.status,200,JSON.stringify(b.body));
  assert.deepEqual(metrics(f),{subscriptionOrders:1,events:1,periods:1,credits:0,packageOrders:0});
  const event=f.sql.prepare('SELECT merchant_provider,body_sha256,event_type FROM subscription_payment_events').get();
  assert.equal(event.merchant_provider,'xiaodou');
  assert.equal(event.event_type,'PAYMENT_SUCCEEDED');
  assert.ok(event.body_sha256.length>40);
 }finally{f.sql.close();}
});

test('signed provider identity or amount mismatch cannot grant a subscription',async()=>{
 const f=ready();
 try{
  const r=await create(f);
  assert.equal(r.status,201);
  const id=r.body.order.id;
  const bad=await query(f,id,{amountFen:6991});
  assert.equal(bad.status,409,JSON.stringify(bad.body));
  assert.equal(metrics(f).events,0);
  assert.equal(metrics(f).periods,0);
  const valid=await query(f,id);
  assert.equal(valid.status,200,JSON.stringify(valid.body));
  assert.equal(metrics(f).periods,1);
 }finally{f.sql.close();}
});

test('Xiaodou WeChat remains hidden even if a dashboard release bit was set',async()=>{
 const f=ready();
 try{
  f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_wechat_enabled','payment_rsa2_wechat_released')");
  const catalog=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.equal(catalog.status,200);
  assert.deepEqual(catalog.body.paymentMethods,['ALIPAY_H5']);
  const rejected=await create(f,req('xd-subscription-wechat-0001','basic','WECHAT_H5'));
  assert.equal(rejected.status,503);
  assert.equal(metrics(f).subscriptionOrders,0);
 }finally{f.sql.close();}
});

test('ambiguous RSA2 creation retains one local transaction and cannot reissue cashier',async()=>{
 const f=ready();
 try{
  const a=await withProvider(()=>{throw new Error('synthetic transport timeout');},()=>f.call('/v1/subscriptions/orders',{body:req('xd-timeout-0001')}));
  assert.equal(a.status,502,JSON.stringify(a.body));
  assert.equal(a.body.code,'SUBSCRIPTION_CHECKOUT_UNCONFIRMED');
  assert.equal(metrics(f).subscriptionOrders,1);
  assert.equal(metrics(f).events,0);
  assert.equal(metrics(f).periods,0);
  const b=await withProvider(()=>{throw new Error('must not call create twice');},()=>f.call('/v1/subscriptions/orders',{body:req('xd-timeout-0001')}));
  assert.equal(b.status,409,JSON.stringify(b.body));
  assert.equal(metrics(f).subscriptionOrders,1);
 }finally{f.sql.close();}
});
