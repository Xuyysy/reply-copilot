import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,withProvider,providerResponse,platform,worker } from './helpers/payment-v2.mjs';
import {createHash,sign} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';

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


test('a real signed Xiaodou subscription webhook settles through a separate signed GET',async()=>{
 const f=ready();
 try{
  const r=await create(f,req('xd-webhook-0001'));
  assert.equal(r.status,201,JSON.stringify(r.body));
  const id=r.body.order.id;
  const outTradeNo=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
  const event={eventId:'xd-sub-event-0001',eventType:'PAYMENT_SUCCEEDED',status:'SUCCEEDED',
   appId:f.env.XIAODOU_APP_ID,outTradeNo,grossAmountFen:6990,eventAmountFen:6990,currency:'CNY'};
  const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000)),nonce='xd-webhook-nonce-1234',kid='test-platform';
  const canonical=['XD-Webhook-v1',event.eventId,event.eventType,timestamp,nonce,kid,createHash('sha256').update(raw).digest('hex')].join('\n');
  const sig=sign('RSA-SHA256',Buffer.from(canonical),platform.privateKey).toString('base64');
  const headers={'Content-Type':'application/json','X-XD-Webhook-Event-Id':event.eventId,'X-XD-Webhook-Event-Type':event.eventType,
   'X-XD-Webhook-Timestamp':timestamp,'X-XD-Webhook-Nonce':nonce,'X-XD-Webhook-Key-Id':kid,'X-XD-Webhook-Signature':sig};
  const res=await withProvider(req=>{
    assert.equal(new URL(req.url).pathname,'/api/open/v1/payments/'+outTradeNo);
    return providerResponse(req,{outTradeNo,amountFen:6990,currency:'CNY',channel:'ALIPAY_H5',
     openOrderId:'xd-open-order-0001',status:'SUCCEEDED',payUrl:null},{status:200});
   },()=>worker.fetch(new Request(f.env.API_ORIGIN+'/v1/payments/xiaodou/webhook',{method:'POST',headers,body:raw}),f.env));
  assert.equal(res.status,200,await res.text());
  assert.equal(metrics(f).events,1);
  assert.equal(metrics(f).periods,1);
  assert.equal(metrics(f).credits,0);
 }finally{f.sql.close();}
});

test('schema migration 0025 preserves MK99 subscription payment proofs and permits RSA2 rows',()=>{
 const db=new DatabaseSync(':memory:');
 try{
   const root=new URL('../migrations/',import.meta.url);
   const names=readdirSync(root).filter(x=>x.endsWith('.sql')).sort();
   for(const name of names.filter(x=>x<'0025_subscription_xiaodou_rsa2.sql'))
     db.exec(readFileSync(new URL(name,root),'utf8'));
   db.exec("INSERT INTO users(id,email,email_verified_at,created_at,username,password_hash) VALUES('user-old','old@example.test',1,1,'old-user','hash')");
   db.exec("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES('order-old','user-old','basic-v1','purchase',6990,1,999999999,1,1)");
   db.exec("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,created_at,updated_at) VALUES('tx-old','order-old','mk99','merchant-old','MK99_old_trade','ALIPAY_H5',6990,'MD5',1,1)");
   db.exec("INSERT INTO subscription_payment_events(id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at) VALUES('event-old','tx-old','mk99','mk99-sub-old','PAYMENT_SUCCEEDED',6990,'verified-old-hash',1)");
   db.exec(readFileSync(new URL('0025_subscription_xiaodou_rsa2.sql',root),'utf8'));
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   assert.equal(db.prepare("SELECT body_sha256 FROM subscription_payment_events WHERE id='event-old'").get().body_sha256,'verified-old-hash');
   assert.equal(db.prepare("SELECT merchant_provider FROM subscription_payment_transactions WHERE id='tx-old'").get().merchant_provider,'mk99');
   db.exec("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES('order-xd','user-old','basic-v1','purchase',6990,1,999999999,1,1)");
   db.exec("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,created_at,updated_at) VALUES('tx-xd','order-xd','xiaodou','xdop_1234567890abcdef','XD_new_trade','ALIPAY_H5',6990,'mkid_0123456789abcdef',1,1)");
   assert.equal(db.prepare("SELECT merchant_provider FROM subscription_payment_transactions WHERE id='tx-xd'").get().merchant_provider,'xiaodou');
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});
