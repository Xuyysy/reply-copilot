import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,withProvider,providerResponse,platform,worker } from './helpers/payment-v2.mjs';
import {createHash,sign,randomUUID} from 'node:crypto';
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

test('Xiaodou linkless UNKNOWN keeps the original order while new buyer key permits subscription retry',async()=>{
 const f=ready();try{
  const old=await withProvider(()=>{throw new Error('synthetic transport timeout');},()=>f.call('/v1/subscriptions/orders',{body:req('xd-timeout-0001')}));
  assert.equal(old.status,502,JSON.stringify(old.body));assert.equal(old.body.order.retryAvailable,true);
  const repeated=await withProvider(()=>{throw new Error('must not call create twice');},()=>f.call('/v1/subscriptions/orders',{body:req('xd-timeout-0001')}));
  assert.equal(repeated.status,409);assert.equal(repeated.body.order.retryAvailable,true);
  const fresh=await create(f,req('xd-timeout-0002'));
  assert.equal(fresh.status,201,JSON.stringify(fresh.body));assert.notEqual(fresh.body.order.id,old.body.order.id);
  assert.equal(f.sql.prepare("SELECT status FROM subscription_orders WHERE id=?").get(old.body.order.id).status,'unknown');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_orders").get().n,2);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_payment_events").get().n,0);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_periods").get().n,0);
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
   // Review unapproved schema proposal only in isolated SQLite memory.
   db.exec(readFileSync(new URL('../sql-proposals/0025_subscription_xiaodou_rsa2.sql',root),'utf8'));
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
   assert.equal(db.prepare("SELECT body_sha256 FROM subscription_payment_events WHERE id='event-old'").get().body_sha256,'verified-old-hash');
   assert.equal(db.prepare("SELECT merchant_provider FROM subscription_payment_transactions WHERE id='tx-old'").get().merchant_provider,'mk99');
   db.exec("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,quoted_at,quote_expires_at,created_at,updated_at) VALUES('order-xd','user-old','basic-v1','purchase',6990,1,999999999,1,1)");
   db.exec("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,created_at,updated_at) VALUES('tx-xd','order-xd','xiaodou','xdop_1234567890abcdef','XD_new_trade','ALIPAY_H5',6990,'mkid_0123456789abcdef',1,1)");
   assert.equal(db.prepare("SELECT merchant_provider FROM subscription_payment_transactions WHERE id='tx-xd'").get().merchant_provider,'xiaodou');
   assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.close();}
});


test('admin switches both products to Xiaodou after explicit subscription and network-mode readiness',async()=>{
 const f=ready();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'");
  f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
  f.sql.prepare("INSERT INTO admin_reauth_sessions VALUES(?,?)").run('test-session',Date.now()+600000);
  f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
  const params=()=>({operationId:randomUUID(),reason:'Payment merchant switch integration readiness verified',
   merchantSettings:{activeMerchant:'xiaodou',enabled:false,alipayEnabled:false,
    wechatEnabled:false,alipayReleased:false,wechatReleased:false}});
  f.env.XIAODOU_SOURCE_IP_CONFIRMED='0';
  const rejected=await f.call('/v1/admin/payment-control',{body:params()});
  assert.equal(rejected.status,409,JSON.stringify(rejected.body));
  assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='active_merchant'").get().value,'mk99');
  // Vendor IP allowlist disabled by operator: no fixed Worker egress required.
  f.env.XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED='1';
  const accepted=await f.call('/v1/admin/payment-control',{body:params()});
  assert.equal(accepted.status,200,JSON.stringify(accepted.body));
  assert.equal(accepted.body.activeMerchant,'xiaodou');
  const packages=await f.call('/v1/packages',{method:'GET'});
  const subscriptions=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.deepEqual(packages.body.paymentMethods,[{provider:'xiaodou',channel:'ALIPAY_H5'}]);
  assert.deepEqual(subscriptions.body.paymentMethods,['ALIPAY_H5']);
 }finally{f.sql.close();}
});

test('Xiaodou signed settlement handles a prorated tier upgrade without a second period or credit grant',async()=>{
 const f=ready();
 try{
  const first=await create(f,req('xd-upgrade-origin-001'));
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal((await query(f,first.body.order.id)).status,200);
  const periodBefore=f.sql.prepare('SELECT id,start_at,end_at,daily_limit FROM subscription_periods').get();
  const quote=await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'pro'}});
  assert.equal(quote.status,200,JSON.stringify(quote.body));
  assert.equal(quote.body.quote.amountFen,5000);
  const up=await withProvider(r=>{
    const b=JSON.parse(r.body);
    assert.equal(b.amountFen,5000);
    assert.equal(b.channel,'ALIPAY_H5');
    return providerResponse(r,{outTradeNo:b.outTradeNo,amountFen:5000,channel:'ALIPAY_H5',
      openOrderId:'xd-upgrade-0002',payUrl:'https://cashier.example.test/pay/upgrade'});
   },()=>f.call('/v1/subscriptions/orders',{body:{...req('xd-upgrade-0002','pro'),quoteId:quote.body.quote.id}}));
  assert.equal(up.status,201,JSON.stringify(up.body));
  assert.equal(up.body.order.kind,'upgrade');
  const id=up.body.order.id;
  const trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
  const verify=()=>withProvider(r=>providerResponse(r,{outTradeNo:trade,amountFen:5000,currency:'CNY',
    channel:'ALIPAY_H5',status:'SUCCEEDED',openOrderId:'xd-upgrade-0002',payUrl:null},{status:200}),
    ()=>f.call('/v1/subscriptions/orders/'+id+'/refresh',{body:{}}));
  const settled=await verify();
  assert.equal(settled.status,200,JSON.stringify(settled.body));
  assert.equal(settled.body.entitlementApplied,true);
  assert.equal((await verify()).status,200);
  const periodAfter=f.sql.prepare('SELECT id,start_at,end_at,daily_limit FROM subscription_periods').get();
  assert.deepEqual([periodAfter.id,periodAfter.start_at,periodAfter.end_at,periodAfter.daily_limit],
    [periodBefore.id,periodBefore.start_at,periodBefore.end_at,1000]);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_tier_changes').get().n,1);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_periods').get().n,1);
  assert.equal(metrics(f).credits,0);
 }finally{f.sql.close();}
});

test('Xiaodou renewed subscription is queued for the next period and does not increase permanent credits',async()=>{
 const f=ready();
 try{
  const base=await create(f,req('xd-renew-initial-001'));
  assert.equal(base.status,201,JSON.stringify(base.body));
  assert.equal((await query(f,base.body.order.id)).status,200);
  const renewal=await create(f,req('xd-renew-next-002'),{openOrderId:'xd-renew-open-0002'});
  assert.equal(renewal.status,201,JSON.stringify(renewal.body));
  assert.equal(renewal.body.order.kind,'renewal');
  const id=renewal.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
  const paid=await withProvider(r=>providerResponse(r,{outTradeNo:trade,amountFen:6990,currency:'CNY',
    channel:'ALIPAY_H5',status:'SUCCEEDED',openOrderId:'xd-renew-open-0002',payUrl:null},{status:200}),
    ()=>f.call('/v1/subscriptions/orders/'+id+'/refresh',{body:{}}));
  assert.equal(paid.status,200,JSON.stringify(paid.body));
  assert.equal(paid.body.entitlementApplied,true);
  assert.deepEqual(f.sql.prepare('SELECT status FROM subscription_periods ORDER BY created_at,id').all().map(x=>x.status).sort(),['active','queued']);
  assert.equal(metrics(f).periods,2);
  assert.equal(metrics(f).credits,0);
 }finally{f.sql.close();}
});


test('Xiaodou methods require confirmed network mode, subscriptions and webhooks',async()=>{
 const f=ready();
 try{
  f.env.XIAODOU_SOURCE_IP_CONFIRMED='0';
  let p=await f.call('/v1/packages',{method:'GET'});
  let s=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[]);
  assert.deepEqual(s.body.paymentMethods,[]);
  f.env.XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED='true';
  p=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[],'only exact 1 counts as operator confirmation');
  f.env.XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED='1';
  f.env.XIAODOU_RSA2_SUBSCRIPTIONS_READY='0';
  p=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[]);
  f.env.XIAODOU_RSA2_SUBSCRIPTIONS_READY='1';
  f.env.XIAODOU_WEBHOOKS_ENABLED='0';
  p=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[],'signed Webhook readiness cannot be bypassed');
  f.env.XIAODOU_WEBHOOKS_ENABLED='1';
  p=await f.call('/v1/packages',{method:'GET'});
  s=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[{provider:'xiaodou',channel:'ALIPAY_H5'}]);
  assert.deepEqual(s.body.paymentMethods,['ALIPAY_H5']);
  f.env.XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED='0';
  f.env.XIAODOU_SOURCE_IP_CONFIRMED='1';
  p=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(p.body.paymentMethods,[{provider:'xiaodou',channel:'ALIPAY_H5'}],'legacy verified egress remains supported');
 }finally{f.sql.close();}
});


test('Xiaodou relaunch checks signed unpaid state then refreshes QR without creating a subscription',async()=>{
 const f=ready();
 try{
  const created=await create(f,req('xd-relaunch-0001'));assert.equal(created.status,201);
  const id=created.body.order.id;
  const trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
  const paths=[];
  const result=await withProvider(r=>{
   const path=new URL(r.url).pathname;paths.push(r.method+' '+path);
   if(r.method==='GET')return providerResponse(r,{outTradeNo:trade,status:'CREATED',amountFen:6990,channel:'ALIPAY_H5',currency:'CNY',payUrl:null},{status:200});
   assert.equal(r.method,'POST');
   assert.equal(path,'/api/open/v1/payments/'+trade+'/attempts');
   return providerResponse(r,{outTradeNo:trade,status:'PAYING',openOrderId:'xd-open-order-0001',
     amountFen:6990,channel:'ALIPAY_H5',currency:'CNY',payUrl:'https://cashier.example.test/pay/fresh'});
  },()=>f.call('/v1/subscriptions/orders/'+id+'/attempts',{body:{}}));
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.deepEqual(paths,['GET /api/open/v1/payments/'+trade,'POST /api/open/v1/payments/'+trade+'/attempts']);
  assert.equal(result.body.order.id,id);
  assert.equal(result.body.order.checkout.paymentUrl,'https://cashier.example.test/pay/fresh');
  assert.deepEqual(metrics(f),{subscriptionOrders:1,events:0,periods:0,credits:0,packageOrders:0});
 }finally{f.sql.close();}
});

test('Xiaodou UNKNOWN prevents QR relaunch and any new provider attempt',async()=>{
 const f=ready();
 try{
  const created=await create(f,req('xd-relaunch-unknown-0001'));assert.equal(created.status,201);
  const id=created.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
  let calls=0;
  const result=await withProvider(r=>{
   calls++;assert.equal(r.method,'GET');
   return providerResponse(r,{outTradeNo:trade,status:'UNKNOWN',amountFen:6990,channel:'ALIPAY_H5',currency:'CNY',payUrl:null},{status:200});
  },()=>f.call('/v1/subscriptions/orders/'+id+'/attempts',{body:{}}));
  assert.equal(result.status,409,JSON.stringify(result.body));
  assert.equal(calls,1);
  assert.deepEqual(metrics(f),{subscriptionOrders:1,events:0,periods:0,credits:0,packageOrders:0});
 }finally{f.sql.close();}
});


test('a paid Xiaodou subscription exposes a verified period and never restores its cashier',async()=>{
 const f=ready();
 try{
  const created=await create(f,req('xd-paid-period-view-0001'));assert.equal(created.status,201);
  const id=created.body.order.id;
  const settled=await query(f,id);assert.equal(settled.status,200);
  const detail=await f.call('/v1/subscriptions/orders/'+id,{method:'GET'});
  assert.equal(detail.status,200);
  assert.equal(detail.body.order.periodStatus,'active');
  assert.equal(detail.body.order.checkout.paymentConfirmed,true);
  assert.equal(detail.body.order.checkout.paymentUrl,null);
 }finally{f.sql.close();}
});

test('signed Xiaodou CLOSED releases an unpaid subscription; historical order remains archived',async()=>{
 const f=ready();try{
   const first=await create(f,req('xd-close-expired-0001'));assert.equal(first.status,201);
   const id=first.body.order.id;
   const closed=await query(f,id,{status:'CLOSED',payUrl:null});
   assert.equal(closed.status,200,JSON.stringify(closed.body));
   assert.equal(closed.body.orderStatus,'closed');
   const state=f.sql.prepare('SELECT o.status order_status,t.status payment_status FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=?').get(id);
   assert.deepEqual({...state},{order_status:'closed',payment_status:'closed'});
   assert.equal(metrics(f).periods,0);assert.equal(metrics(f).events,0);
   const again=await create(f,req('xd-after-closed-0002','pro'),{openOrderId:'xd-open-order-second-0002'});
   assert.equal(again.status,201,JSON.stringify(again.body));assert.notEqual(again.body.order.id,id);
   assert.equal(metrics(f).subscriptionOrders,2);
 }finally{f.sql.close();}
});

test('signed Xiaodou FAILED also releases, but UNKNOWN / PAYING remain blocked',async()=>{
 for(const status of ['UNKNOWN','PAYING','FAILED']){
   const f=ready();try{
     const first=await create(f,req('xd-status-'+status+'-0001'));
     const id=first.body.order.id,checking=await query(f,id,{status,payUrl:null});
     assert.equal(checking.status,200,JSON.stringify(checking.body));
     const attempt=await create(f,req('xd-status-'+status+'-new','pro'),{openOrderId:'xd-open-order-second-'+status});
     if(status==='FAILED'){
       assert.equal(checking.body.orderStatus,'failed');
       assert.equal(attempt.status,201,JSON.stringify(attempt.body));
     }else{
       assert.equal(checking.body.orderStatus,'pending');
       assert.equal(attempt.status,409,JSON.stringify(attempt.body));
     }
     assert.equal(metrics(f).periods,0);
   }finally{f.sql.close();}
 }
});

test('authenticated subscription order listing auto-reconciles signed CLOSED once, then unlocks pricing',async()=>{
 const f=ready();try{
   const first=await create(f,req('xd-autoclose-0001'));assert.equal(first.status,201);
   const id=first.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
   let calls=0;
   const list=await withProvider(r=>{
     calls++;assert.equal(r.method,'GET');assert.equal(new URL(r.url).pathname,'/api/open/v1/payments/'+trade);
     return providerResponse(r,{outTradeNo:trade,status:'CLOSED',amountFen:6990,currency:'CNY',channel:'ALIPAY_H5',payUrl:null},{status:200});
   },()=>f.call('/v1/subscriptions/orders',{method:'GET'}));
   assert.equal(list.status,200,JSON.stringify(list.body));assert.equal(calls,1);
   assert.equal(list.body.orders[0].status,'closed');
   const after=await create(f,req('xd-autoclose-pro-0002','pro'),{openOrderId:'xd-open-order-second-0002'});assert.equal(after.status,201,JSON.stringify(after.body));
   assert.equal(metrics(f).periods,0);
 }finally{f.sql.close();}
});

test('late signed SUCCEEDED after CLOSED is audited and held for review without granting entitlement',async()=>{
 const f=ready();try{
   const first=await create(f,req('xd-latepaid-0001'));assert.equal(first.status,201);
   const id=first.body.order.id;
   const closed=await query(f,id,{status:'CLOSED',payUrl:null});assert.equal(closed.body.orderStatus,'closed');
   const late=await query(f,id,{status:'SUCCEEDED',payUrl:null});
   assert.equal(late.status,200,JSON.stringify(late.body));
   assert.equal(late.body.orderStatus,'manual_review');assert.equal(late.body.paymentConfirmed,true);
   assert.equal(late.body.entitlementApplied,false);
   const states=f.sql.prepare('SELECT o.status order_status,t.status payment_status,t.risk_state FROM subscription_orders o JOIN subscription_payment_transactions t ON t.order_id=o.id WHERE o.id=?').get(id);
   assert.deepEqual({...states},{order_status:'manual_review',payment_status:'paid',risk_state:'manual_review'});
   assert.equal(metrics(f).periods,0);assert.equal(metrics(f).events,1);
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
   const replay=await query(f,id,{status:'SUCCEEDED',payUrl:null});
   assert.equal(replay.status,200,JSON.stringify(replay.body));assert.equal(replay.body.entitlementApplied,false);
   assert.equal(metrics(f).periods,0);assert.equal(metrics(f).events,1);
 }finally{f.sql.close();}
});

test('Xiaodou signed provider mismatch cannot release the blocked subscription',async()=>{
 const f=ready();try{
   const first=await create(f,req('xd-mismatchclosed-0001'));assert.equal(first.status,201);
   const id=first.body.order.id,invalid=await query(f,id,{status:'CLOSED',amountFen:6991,payUrl:null});
   assert.equal(invalid.status,409);
   assert.equal(f.sql.prepare('SELECT status FROM subscription_orders WHERE id=?').get(id).status,'pending');
   const other=await create(f,req('xd-mismatchclosed-0002','pro'));assert.equal(other.status,409);
 }finally{f.sql.close();}
});

test('owner-confirmed Xiaodou subscription cancellation calls merchant close, then unlocks the plan',async()=>{
 const f=ready();try{
   const first=await create(f,req('xd-sub-cancel-0001'));assert.equal(first.status,201);
   const id=first.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
   let calls=0;
   const closed=await withProvider(r=>{
     calls++;assert.equal(r.method,'POST');assert.equal(new URL(r.url).pathname,'/api/open/v1/payments/'+trade+'/close');
     return providerResponse(r,{outTradeNo:trade,amountFen:6990,currency:'CNY',channel:'ALIPAY_H5',
       closeState:'CLOSE_REQUESTED',status:'CLOSED',payUrl:null},{status:200});
   },()=>f.call('/v1/subscriptions/orders/'+id+'/cancel',{body:{}}));
   assert.equal(closed.status,200,JSON.stringify(closed.body));assert.equal(calls,1);
   assert.equal(closed.body.orderStatus,'closed');assert.equal(closed.body.order.status,'closed');
   assert.equal(metrics(f).periods,0);
   const replaced=await create(f,req('xd-sub-cancel-new-0002','pro'),{openOrderId:'xd-after-cancel-open-0002'});
   assert.equal(replaced.status,201,JSON.stringify(replaced.body));
 }finally{f.sql.close();}
});

test('Xiaodou subscription cancel refuses uncertain merchant close and leaves original blocking',async()=>{
 for(const closeState of ['UNKNOWN_KEPT','PROVIDER_PAID_CONFLICT']){
   const f=ready();try{
     const first=await create(f,req('xd-sub-cancel-'+closeState));assert.equal(first.status,201);
     const id=first.body.order.id,trade=f.sql.prepare('SELECT provider_trade_id FROM subscription_payment_transactions WHERE order_id=?').get(id).provider_trade_id;
     const rejected=await withProvider(r=>providerResponse(r,{outTradeNo:trade,amountFen:6990,
       currency:'CNY',channel:'ALIPAY_H5',closeState,status:'PAYING',payUrl:null},{status:200}),
       ()=>f.call('/v1/subscriptions/orders/'+id+'/cancel',{body:{}}));
     assert.equal(rejected.status,409,JSON.stringify(rejected.body));
     assert.equal(f.sql.prepare('SELECT status FROM subscription_orders WHERE id=?').get(id).status,'pending');
     assert.equal(metrics(f).periods,0);
   }finally{f.sql.close();}
 }
});

test('Xiaodou subscription cancel must reject another user without calling merchant',async()=>{
 const f=ready();try{
   const first=await create(f,req('xd-sub-not-owner-0001'));assert.equal(first.status,201);
   const id=first.body.order.id;
   f.sql.exec("INSERT INTO users(id,email,status,created_at,email_verified_at) VALUES('other','different@example.test','active',1,1)");
   f.sql.prepare("UPDATE subscription_orders SET user_id=? WHERE id=?").run('other',id);
   const res=await f.call('/v1/subscriptions/orders/'+id+'/cancel',{body:{}});
   assert.equal(res.status,404);
 }finally{f.sql.close();}
});
