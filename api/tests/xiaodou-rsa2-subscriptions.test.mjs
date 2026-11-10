import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,withProvider,providerResponse,worker,platform} from './helpers/payment-v2.mjs';
import {createHash,sign} from 'node:crypto';

const cashier='https://cashier.example.test';
function ready(){
 const f=fixture({released:true});
 Object.assign(f.env,{
  SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',SUBSCRIPTION_CHECKOUT_ENABLED:'1',
  XIAODOU_CASHIER_ORIGINS:cashier,
  __TEST_LEGACY_EPAY_NEW_SALES:'0',
  XIAODOU_WECHAT_APPROVED:'0',
  XIAODOU_TRADE_SCOPE:'CARD_VIRTUAL'
 });
 f.sql.exec("UPDATE system_settings SET value='xiaodou' WHERE key='active_merchant'");
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_enabled','payment_rsa2_alipay_enabled','payment_rsa2_alipay_released','payment_epay_enabled','payment_epay_alipay_enabled','payment_epay_alipay_released')");
 return f;
}
function projection(total){
 return {ruleVersion:'test-v1',thresholdFen:0,tier:'STANDARD',merchantRateBps:10000,
  companyServiceFeeRateBps:0,merchantSettlementFen:total,companyServiceFeeFen:0};
}
const request={planCode:'basic',channel:'ALIPAY_H5',idempotencyKey:'xiaodou-checkout-001'};
async function create(f,handler){
 return withProvider(req=>{
  assert.equal(new URL(req.url).pathname,'/api/open/v1/payments');
  const sent=JSON.parse(req.body);
  if(handler)return handler(req,sent);
  assert.equal(sent.amountFen,6990);
  assert.equal(sent.tradeScope,'CARD_VIRTUAL');
  assert.equal(sent.channel,'ALIPAY_H5');
  assert.equal(sent.feeBearer,undefined);
  assert.equal(sent.returnUrl,'https://staging.example.test/subscription-checkout/');
  return providerResponse(req,{openOrderId:'XD_ORDER_123456',outTradeNo:sent.outTradeNo,
   channel:'ALIPAY_H5',amountFen:6990,status:'CREATED',currency:'CNY',
   payUrl:cashier+'/pay/'+sent.outTradeNo,feeProjection:projection(6990)});
 },()=>f.call('/v1/subscriptions/orders',{body:request}));
}
test('all-product Xiaodou merchant only exposes native RSA2 (Epay legacy settings cannot offer new sales)',async()=>{
 const f=ready();
 try{
  const catalog=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.equal(catalog.body.checkoutAvailable,true);
  assert.deepEqual(catalog.body.paymentMethods,['ALIPAY_H5']);
  const packs=await f.call('/v1/packages',{method:'GET'});
  assert.ok(packs.body.paymentMethods.some(m=>m.provider==='xiaodou'&&m.channel==='ALIPAY_H5'));
  assert.equal(packs.body.paymentMethods.some(m=>m.provider==='xiaodou_epay'),false);
 }finally{f.sql.close();}
});
test('one RSA2 subscription checkout freezes merchant and one signed query grants period, not credits',async()=>{
 const f=ready();
 try{
  const created=await create(f);
  assert.equal(created.status,201,JSON.stringify(created.body));
  assert.match(created.body.order.checkout.paymentUrl,/^https:\/\/cashier\.example\.test\//);
  const tx=f.sql.prepare('SELECT * FROM subscription_payment_transactions').get();
  assert.equal(tx.merchant_provider,'xiaodou');
  assert.equal(tx.notification_sign_type,'RSA-SHA256');
  assert.equal(tx.merchant_account,f.env.XIAODOU_APP_ID);
  assert.equal(tx.amount_fen,6990);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,0);
  const again=await create(f,()=>{throw Error('Should not create another provider order');});
  assert.equal(again.status,200);
  assert.equal(again.body.resumed,true);
  const result=await withProvider(req=>{
   assert.equal(req.method,'GET');
   assert.equal(new URL(req.url).pathname,'/api/open/v1/payments/'+tx.provider_trade_id);
   return providerResponse(req,{outTradeNo:tx.provider_trade_id,openOrderId:'XD_ORDER_123456',
     channel:'ALIPAY_H5',amountFen:6990,currency:'CNY',status:'SUCCEEDED',
     feeProjection:projection(6990),payUrl:null},{status:200});
  },()=>f.call('/v1/subscriptions/orders/'+created.body.order.id+'/refresh'));
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.paymentConfirmed,true);
  assert.equal(result.body.entitlementApplied,true);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,1);
  assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM recharge_orders").get().n,0);
  const againQuery=await withProvider(req=>providerResponse(req,{
    outTradeNo:tx.provider_trade_id,openOrderId:'XD_ORDER_123456',
    channel:'ALIPAY_H5',amountFen:6990,currency:'CNY',status:'SUCCEEDED',
    feeProjection:projection(6990),payUrl:null},{status:200}),
   ()=>f.call('/v1/subscriptions/orders/'+created.body.order.id+'/refresh'));
  assert.equal(againQuery.status,200);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,1);
 }finally{f.sql.close();}
});
test('signed-query mismatched merchant amount can never award subscription or credits',async()=>{
 const f=ready();
 try{
  const created=await create(f);
  assert.equal(created.status,201);
  const tx=f.sql.prepare('SELECT * FROM subscription_payment_transactions').get();
  const mismatch=await withProvider(req=>providerResponse(req,{
    outTradeNo:tx.provider_trade_id,openOrderId:'XD_ORDER_123456',
    channel:'ALIPAY_H5',amountFen:6991,currency:'CNY',status:'SUCCEEDED',
    feeProjection:projection(6991),payUrl:null},{status:200}),
   ()=>f.call('/v1/subscriptions/orders/'+created.body.order.id+'/refresh'));
  assert.equal(mismatch.status,409);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,0);
  assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,0);
 }finally{f.sql.close();}
});
test('merchant switch away never rewrites a pending Xiaodou subscription order',async()=>{
 const f=ready();
 try{
  const created=await create(f);
  assert.equal(created.status,201);
  const tx=f.sql.prepare('SELECT * FROM subscription_payment_transactions').get();
  f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
  const old=await f.call('/v1/subscriptions/orders/'+created.body.order.id,{method:'GET'});
  assert.equal(old.status,200);
  assert.equal(old.body.order.checkout.paymentUrl,cashier+'/pay/'+tx.provider_trade_id);
  const settled=await withProvider(req=>providerResponse(req,{
    outTradeNo:tx.provider_trade_id,openOrderId:'XD_ORDER_123456',
    channel:'ALIPAY_H5',amountFen:6990,currency:'CNY',status:'SUCCEEDED',
    feeProjection:projection(6990),payUrl:null},{status:200}),
   ()=>f.call('/v1/subscriptions/orders/'+created.body.order.id+'/refresh'));
  assert.equal(settled.status,200);
  assert.equal(settled.body.entitlementApplied,true);
 }finally{f.sql.close();}
});

function signedNotice(env,event){
 const body=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000));
 const nonce='callback-nonce-123456789',kid='test-platform';
 const lines=['XD-Webhook-v1',event.eventId,event.eventType,timestamp,nonce,kid,
   createHash('sha256').update(body).digest('hex')].join('\\n');
 const headers={'Content-Type':'application/json','X-XD-Webhook-Event-Id':event.eventId,
  'X-XD-Webhook-Event-Type':event.eventType,'X-XD-Webhook-Timestamp':timestamp,
  'X-XD-Webhook-Nonce':nonce,'X-XD-Webhook-Key-Id':kid,
  'X-XD-Webhook-Signature':sign('RSA-SHA256',Buffer.from(lines),platform.privateKey).toString('base64')};
 return new Request(env.API_ORIGIN+'/v1/payments/xiaodou/webhook',{method:'POST',headers,body});
}
test('repeated signed native Xiaodou subscription webhook grants exactly one subscription, never permanent credits',async()=>{
 const f=ready();
 try{
  const created=await create(f);
  assert.equal(created.status,201);
  const tx=f.sql.prepare('SELECT * FROM subscription_payment_transactions').get();
  const event={appId:f.env.XIAODOU_APP_ID,outTradeNo:tx.provider_trade_id,
    eventId:'xd-event-unique-2001',eventType:'PAYMENT_SUCCEEDED',status:'SUCCEEDED',
    eventAmountFen:6990,grossAmountFen:6990,feeProjection:projection(6990),currency:'CNY',
    occurredAt:Math.floor(Date.now()/1000),stateVersion:0};
  for(let i=0;i<2;i++){
   const notice=await withProvider(req=>providerResponse(req,{
      outTradeNo:tx.provider_trade_id,openOrderId:'XD_ORDER_123456',channel:'ALIPAY_H5',
      amountFen:6990,currency:'CNY',status:'SUCCEEDED',
      feeProjection:projection(6990),payUrl:null
    },{status:200}),()=>worker.fetch(signedNotice(f.env,event),f.env));
   assert.equal(notice.status,200,await notice.text());
   if(i===0)assert.equal(await notice.text(),'success');
  }
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_payment_events WHERE merchant_provider='xiaodou'").get().n,2);
  assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM recharge_orders").get().n,0);
 }finally{f.sql.close();}
});
test('stale D1 WeChat release flags cannot turn on Xiaodou WeChat without explicit merchant approval',async()=>{
 const f=ready();
 try{
  f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_wechat_enabled','payment_rsa2_wechat_released')");
  const c=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.deepEqual(c.body.paymentMethods,['ALIPAY_H5']);
  const p=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[{provider:'xiaodou',channel:'ALIPAY_H5'}]);
  const notAllowed=await f.call('/v1/subscriptions/orders',{body:{...request,channel:'WECHAT_H5'}});
  assert.equal(notAllowed.status,503);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_orders').get().n,0);
 }finally{f.sql.close();}
});
