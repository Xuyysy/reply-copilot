import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,withProvider} from './helpers/payment-v2.mjs';

const merchant='20881234567890',origins='https://cashier.example.test';
function ready(){
 const f=fixture();
 Object.assign(f.env,{
  SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',SUBSCRIPTION_CHECKOUT_ENABLED:'1',
  MK99_PID:merchant,MK99_KEY:'local-fixture-not-a-real-merchant-key',
  MK99_REQUEST_SIGN_TYPE:'MD5',MK99_NOTIFY_SIGN_TYPE:'MD5',
  MK99_PROTOCOL_CONFIRMED:'1',MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL',
  MK99_CASHIER_ORIGINS:origins
 });
 f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_mk99_enabled','payment_mk99_alipay_enabled','payment_mk99_alipay_released','payment_mk99_wechat_enabled','payment_mk99_wechat_released')");
 return f;
}
const request=(planCode='basic',idempotencyKey='checkout-request-0001',channel='ALIPAY_H5')=>({
  planCode,channel,idempotencyKey
});
async function checkout(f,body=request(),handler){
 let calls=0,outTrade;
 const result=await withProvider(req=>{
  calls++;
  const params=Object.fromEntries(new URLSearchParams(req.body));
  outTrade=params.out_trade_no;
  assert.equal(new URL(req.url).origin,'https://mk99.cn');
  assert.equal(new URL(req.url).pathname,'/openapi/pay/create');
  if(handler)return handler(req,params);
  return Response.json({code:1,data:{trade_no:'MK99_paid_'+outTrade,out_trade_no:outTrade,pay_url:origins+'/pay/'+outTrade}});
 },()=>f.call('/v1/subscriptions/orders',{body}));
 return {...result,calls,outTrade};
}
const metrics=f=>({
 orders:f.sql.prepare("SELECT count(*) n FROM subscription_orders").get().n,
 transactions:f.sql.prepare("SELECT count(*) n FROM subscription_payment_transactions").get().n,
 events:f.sql.prepare("SELECT count(*) n FROM subscription_payment_events").get().n,
 credits:f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,
 legacy:f.sql.prepare("SELECT count(*) n FROM recharge_orders").get().n,
 periods:f.sql.prepare("SELECT count(*) n FROM subscription_periods").get().n
});


test('staging merchant checkout requires the designated test user before any provider request or order write',async()=>{
 const f=ready();
 try{
  f.env.STAGING_PAYMENT_TEST_USER_EMAIL='someone-else@example.test';
  const wrong=await checkout(f);
  assert.equal(wrong.status,403);
  assert.equal(wrong.calls,0);
  assert.deepEqual(metrics(f),{orders:0,transactions:0,events:0,credits:0,legacy:0,periods:0});
  const quote=await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'pro'}});
  assert.equal(quote.status,403);
  f.env.STAGING_PAYMENT_TEST_USER_EMAIL='';
  const missing=await checkout(f);
  assert.equal(missing.status,403);
  assert.equal(missing.calls,0);
  f.env.STAGING_PAYMENT_TEST_USER_EMAIL='V2@EXAMPLE.TEST';
  const ok=await checkout(f);
  assert.equal(ok.status,201);
  assert.equal(ok.calls,1);
 }finally{f.sql.close();}
});

test('subscription MK99 checkout is independently disabled even if catalog and paid-query features are enabled',async()=>{
 const f=ready();
 try{
  f.env.SUBSCRIPTION_CHECKOUT_ENABLED='0';
  const r=await checkout(f);
  assert.equal(r.status,404);
  assert.equal(r.calls,0);
  assert.deepEqual(metrics(f),{orders:0,transactions:0,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('one-shot checkout freezes server price and merchant/channel, never grants credits or a subscription',async()=>{
 const f=ready();
 try{
  const r=await checkout(f);
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.calls,1);
  assert.equal(r.body.order.planCode,'basic');
  assert.equal(r.body.order.kind,'purchase');
  assert.equal(r.body.order.amountFen,6990);
  assert.equal(r.body.order.channel,'ALIPAY_H5');
  assert.equal(r.body.order.checkout.paymentUrl,origins+'/pay/'+r.outTrade);
  assert.equal(r.body.order.checkout.paymentConfirmed,false);
  const o=f.sql.prepare("SELECT kind,amount_fen,operation_id,status FROM subscription_orders").get();
  assert.equal(o.kind,'purchase');
  assert.equal(o.amount_fen,6990);
  assert.match(o.operation_id,/^sub-checkout:test-user:checkout-request-0001$/);
  const tx=f.sql.prepare("SELECT checkout_state,checkout_attempted_at,cashier_ready_at,cashier_url,merchant_account,provider_trade_id,provider_payment_id,amount_fen FROM subscription_payment_transactions").get();
  assert.equal(tx.checkout_state,'ready');
  assert.equal(tx.amount_fen,6990);
  assert.equal(tx.merchant_account,merchant);
  assert.equal(tx.provider_trade_id,r.outTrade);
  assert.ok(tx.checkout_attempted_at>0&&tx.cashier_ready_at>0);
  assert.deepEqual(metrics(f),{orders:1,transactions:1,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('same idempotency key and concurrent second submit never trigger another MK99 create',async()=>{
 const f=ready();
 try{
  const one=await checkout(f);
  assert.equal(one.status,201);
  const again=await checkout(f);
  assert.equal(again.status,200);
  assert.equal(again.calls,0);
  assert.equal(again.body.resumed,true);
  assert.equal(again.body.order.id,one.body.order.id);
  const other=await checkout(f,request('basic','checkout-request-0002'));
  assert.equal(other.status,200);
  assert.equal(other.calls,0);
  assert.equal(other.body.order.id,one.body.order.id);
  const different=await checkout(f,request('pro','checkout-request-0003'));
  assert.equal(different.status,409);
  assert.equal(different.calls,0);
  assert.deepEqual(metrics(f),{orders:1,transactions:1,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('provider network uncertainty stores one recoverable order and NEVER redrives it',async()=>{
 const f=ready();
 try{
  const uncertain=await checkout(f,request(),()=>{throw new Error('simulated provider timeout');});
  assert.equal(uncertain.status,502);
  assert.equal(uncertain.calls,1);
  assert.equal(uncertain.body.code,'SUBSCRIPTION_CHECKOUT_UNCONFIRMED');
  assert.ok(uncertain.body.order.id);
  const state=f.sql.prepare("SELECT status,checkout_state,cashier_url FROM subscription_payment_transactions").get();
  assert.equal(state.checkout_state,'unknown');
  assert.equal(state.status,'unknown');
  assert.equal(state.cashier_url,null);
  const again=await checkout(f);
  assert.equal(again.status,409);
  assert.equal(again.calls,0);
  assert.equal(again.body.order.id,uncertain.body.order.id);
  assert.deepEqual(metrics(f),{orders:1,transactions:1,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('wrong cashier identity or origin never appears as payable and remains one uncertain local order',async()=>{
 for(const bad of [
  ({params})=>Response.json({code:1,data:{trade_no:'MK99_bad',out_trade_no:'WRONG_ORDER',pay_url:origins+'/pay'}}),
  ({params})=>Response.json({code:1,data:{trade_no:'MK99_bad',out_trade_no:params.out_trade_no,pay_url:'https://evil.example.net/pay'}})
 ]){
  const f=ready();
  try{
   const r=await checkout(f,request(),(_req,params)=>bad({params}));
   assert.equal(r.status,502);
   assert.equal(r.body.order.checkout.paymentUrl,null);
   assert.equal(r.body.order.checkout.paymentConfirmed,false);
   assert.deepEqual(metrics(f),{orders:1,transactions:1,events:0,credits:0,legacy:0,periods:0});
  }finally{f.sql.close();}
 }
});

test('browser-provided price, extra parameters, bad CSRF and unpublished channel cannot create payment',async()=>{
 const f=ready();
 try{
  let r=await checkout(f,{...request(),priceFen:1});
  assert.equal(r.status,400);
  assert.equal(r.calls,0);
  r=await checkout(f,{...request(),kind:'upgrade'});
  assert.equal(r.status,400);
  assert.equal(r.calls,0);
  r=await checkout(f,request('basic','bad'));
  assert.equal(r.status,400);
  r=await checkout(f,request('ultra','checkout-request-0004','CRYPTO'));
  assert.equal(r.status,400);
  f.sql.exec("UPDATE system_settings SET value='0' WHERE key='payment_mk99_alipay_released'");
  r=await checkout(f,request());
  assert.equal(r.status,503);
  assert.equal(r.calls,0);
  assert.deepEqual(metrics(f),{orders:0,transactions:0,events:0,credits:0,legacy:0,periods:0});
  f.sql.exec("UPDATE system_settings SET value='1' WHERE key='payment_mk99_alipay_released'");
  const cross=await f.call('/v1/subscriptions/orders',{body:request(),headers:{Origin:'https://evil.example.net'}});
  assert.equal(cross.status,403);
  const csrf=await f.call('/v1/subscriptions/orders',{body:request(),headers:{'X-CSRF-Token':'bad'}});
  assert.equal(csrf.status,403);
  assert.deepEqual(metrics(f),{orders:0,transactions:0,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('verified active subscriber creates a renewal, but one queued period blocks further sales',async()=>{
 const f=ready();
 try{
  const now=Date.now(),start=now-1_000;
  f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,paid_at,applied_at) VALUES('prior','test-user','basic-v1','purchase',6990,'paid',1,9999999999999,1,1,?,?)").run(now,now);
  f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,start_at,end_at,created_at,updated_at) VALUES('existing','test-user','prior','basic-v1',500,'active',?,?,1,1)").run(start,start+30*86400000);
  const r=await checkout(f,request('pro','renewal-checkout-0001'));
  assert.equal(r.status,201,JSON.stringify(r.body));
  assert.equal(r.body.order.kind,'renewal');
  assert.equal(r.body.order.amountFen,11990);
  assert.equal(r.body.order.checkout.paymentConfirmed,false);
  f.sql.prepare("UPDATE subscription_orders SET status='paid' WHERE id=?").run(r.body.order.id);
  f.sql.prepare("INSERT INTO subscription_periods(id,user_id,source_order_id,plan_version_id,daily_limit,status,created_at,updated_at) VALUES('queued','test-user',?,'pro-v1',1000,'queued',1,1)").run(r.body.order.id);
  const next=await checkout(f,request('max','another-renewal-0002'));
  assert.equal(next.status,409);
  assert.equal(next.calls,0);
  assert.equal(next.body.code,'SUBSCRIPTION_RENEWAL_QUEUED');
  assert.equal(metrics(f).periods,2);
 }finally{f.sql.close();}
});

test('archived account cannot create an MK99 cashier',async()=>{
 const f=ready();
 try{
  f.sql.exec("UPDATE users SET archived_at=1 WHERE id='test-user'");
  const r=await checkout(f);
  assert.notEqual(r.status,201);
  assert.equal(r.calls,0);
  assert.deepEqual(metrics(f),{orders:0,transactions:0,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('fresh subscription checkout migration is additive and refuses invalid checkout states',async()=>{
 const f=ready();
 try{
  const cols=f.sql.prepare("PRAGMA table_info(subscription_payment_transactions)").all().map(x=>x.name);
  for(const field of ['checkout_state','checkout_attempted_at','cashier_url','cashier_ready_at'])assert.ok(cols.includes(field),field);
  const indexes=f.sql.prepare("PRAGMA index_list(subscription_orders)").all().map(x=>x.name);
  assert.ok(indexes.includes('subscription_orders_user_pending_idx'));
  assert.equal(f.sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 }finally{f.sql.close();}
});

test('a real verified MK99 query settlement is reusable via the original key without a second cashier',async()=>{
 const f=ready();
 try{
  const created=await checkout(f);
  assert.equal(created.status,201);
  const orderId=created.body.order.id;
  const queried=await withProvider(req=>{
    const params=new URLSearchParams(req.body);
    assert.equal(new URL(req.url).pathname,'/openapi/pay/query');
    assert.equal(params.get('out_trade_no'),created.outTrade);
    return Response.json({code:1,data:{
      out_trade_no:created.outTrade,trade_no:'MK99_paid_'+created.outTrade,
      trade_status:'TRADE_SUCCESS',total_amount:'69.90',pid:merchant,paytype_code:'alipay',currency:'CNY'
    }});
   },()=>f.call('/v1/subscriptions/orders/'+orderId+'/refresh'));
  assert.equal(queried.status,200,JSON.stringify(queried.body));
  assert.equal(queried.body.paymentConfirmed,true);
  const duplicate=await checkout(f);
  assert.equal(duplicate.status,200,JSON.stringify(duplicate.body));
  assert.equal(duplicate.calls,0);
  assert.equal(duplicate.body.order.id,orderId);
  assert.equal(duplicate.body.order.checkout.paymentConfirmed,true);
  assert.equal(duplicate.body.order.checkout.outcome,'confirmed');
  assert.deepEqual(metrics(f),{orders:1,transactions:1,events:1,credits:0,legacy:0,periods:1});
 }finally{f.sql.close();}
});

test('manually stamped paid state without transaction and event proof is not represented as confirmed',async()=>{
 const f=ready();
 try{
  const created=await checkout(f);
  assert.equal(created.status,201);
  const now=Date.now();
  f.sql.prepare("UPDATE subscription_orders SET status='paid',paid_at=?,applied_at=? WHERE id=?").run(now,now,created.body.order.id);
  f.sql.prepare("UPDATE subscription_payment_transactions SET status='paid',paid_at=? WHERE order_id=?").run(now,created.body.order.id);
  const again=await checkout(f);
  assert.equal(again.status,409,JSON.stringify(again.body));
  assert.equal(again.calls,0);
  assert.equal(again.body.code,'SUBSCRIPTION_PAYMENT_UNCONFIRMED');
  assert.equal(again.body.order.checkout.paymentConfirmed,false);
  assert.equal(again.body.order.checkout.paymentUrl,null);
  assert.deepEqual(metrics(f),{orders:1,transactions:1,events:0,credits:0,legacy:0,periods:0});
 }finally{f.sql.close();}
});

test('late trusted MK99 success resolves uncertain cashier state without calling create again',async()=>{
 const f=ready();
 try{
  const uncertain=await checkout(f,request(),()=>{throw new Error('provider create outcome lost');});
  assert.equal(uncertain.status,502);
  const orderId=uncertain.body.order.id;
  const confirmed=await withProvider(req=>{
    const params=new URLSearchParams(req.body);
    assert.equal(new URL(req.url).pathname,'/openapi/pay/query');
    assert.equal(params.get('out_trade_no'),uncertain.outTrade);
    return Response.json({code:1,data:{
      out_trade_no:uncertain.outTrade,trade_no:'MK99_late_confirm_'+uncertain.outTrade,
      trade_status:'TRADE_SUCCESS',total_amount:'69.90',pid:merchant,paytype_code:'alipay'
    }});
  },()=>f.call('/v1/subscriptions/orders/'+orderId+'/refresh'));
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  const resumed=await checkout(f);
  assert.equal(resumed.status,200,JSON.stringify(resumed.body));
  assert.equal(resumed.calls,0);
  assert.equal(resumed.body.order.checkout.paymentConfirmed,true);
  assert.equal(resumed.body.order.checkout.outcome,'confirmed');
  assert.deepEqual(metrics(f),{orders:1,transactions:1,events:1,credits:0,legacy:0,periods:1});
 }finally{f.sql.close();}
});

test('upgrade quote is server-owned and authenticated settlement preserves the original bucket',async()=>{
 const f=ready();
 try {
  const initial=await checkout(f);
  assert.equal(initial.status,201);
  const verify=(order,amount)=>withProvider(req=>Response.json({code:1,data:{
   out_trade_no:order.outTrade,trade_no:'MK99_paid_'+order.outTrade,trade_status:'TRADE_SUCCESS',
   total_amount:(amount/100).toFixed(2),pid:merchant,paytype_code:'alipay',currency:'CNY'
  }}),()=>f.call('/v1/subscriptions/orders/'+order.body.order.id+'/refresh',{method:'POST'}));
  assert.equal((await verify(initial,6990)).status,200);
  const before=f.sql.prepare('SELECT * FROM subscription_periods').get();
  f.sql.prepare('INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES(?,0,3,1,1)').run(before.id);
  const quote=await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'pro'}});
  assert.equal(quote.status,200,JSON.stringify(quote.body));
  assert.equal(quote.body.quote.amountFen,5000);
  const order=await checkout(f,{...request('pro','upgrade-request-0001'),quoteId:quote.body.quote.id});
  assert.equal(order.status,201,JSON.stringify(order.body));
  assert.equal(order.body.order.kind,'upgrade');
  assert.equal(order.body.order.amountFen,5000);
  f.sql.exec("CREATE TRIGGER test_fault BEFORE INSERT ON subscription_tier_changes BEGIN SELECT RAISE(ABORT,'test fault'); END");
  assert.equal((await verify(order,5000)).status,409);
  assert.equal(f.sql.prepare('SELECT daily_limit FROM subscription_periods').get().daily_limit,500);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_payment_events').get().n,1);
  f.sql.exec('DROP TRIGGER test_fault');
  assert.equal((await verify(order,5000)).status,200);
  assert.equal((await verify(order,5000)).status,200);
  assert.equal((await verify(initial,6990)).status,200);
  const after=f.sql.prepare('SELECT * FROM subscription_periods').get();
  assert.deepEqual([after.id,after.start_at,after.end_at,after.daily_limit],[before.id,before.start_at,before.end_at,1000]);
  const usage=await f.call('/v1/usage',{method:'GET'});
  assert.equal(usage.body.subscription.remainingToday,996);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_tier_changes').get().n,1);
  const secondQuote=(await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'max'}})).body.quote;
  assert.equal(secondQuote.amountFen,6000);
  const secondOrder=await checkout(f,{...request('max','upgrade-request-0002'),quoteId:secondQuote.id});
  assert.equal((await verify(secondOrder,6000)).status,200);
  assert.equal((await verify(order,5000)).status,200);
  assert.equal(f.sql.prepare('SELECT daily_limit FROM subscription_periods').get().daily_limit,1500);
  const end=Date.now()+3600000;
  f.sql.prepare('UPDATE subscription_periods SET start_at=?,end_at=?').run(end-30*86400000,end);
  assert.equal((await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'ultra'}})).body.code,'SUBSCRIPTION_UPGRADE_FINAL_DAY');
  assert.equal((await checkout(f,request('ultra','next-period-0001'))).body.order.kind,'renewal');
  assert.equal(metrics(f).credits,0);
 } finally {f.sql.close();}
});

test('expired quotes cannot create a cashier and a delayed paid upgrade after expiry enters review',async()=>{
 const f=ready();
 try{
  const first=await checkout(f);
  const verify=(order,amount)=>withProvider(()=>Response.json({code:1,data:{
   out_trade_no:order.outTrade,trade_no:'MK99_paid_'+order.outTrade,trade_status:'TRADE_SUCCESS',
   total_amount:(amount/100).toFixed(2),pid:merchant,paytype_code:'alipay',currency:'CNY'
  }}),()=>f.call('/v1/subscriptions/orders/'+order.body.order.id+'/refresh',{method:'POST'}));
  assert.equal((await verify(first,6990)).status,200);
  let quote=(await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'pro'}})).body.quote;
  f.sql.prepare('UPDATE subscription_upgrade_quotes SET quoted_at=1,expires_at=2 WHERE id=?').run(quote.id);
  const expired=await checkout(f,{...request('pro','expired-quote-0001'),quoteId:quote.id});
  assert.equal(expired.status,409);
  assert.equal(expired.calls,0);
  quote=(await f.call('/v1/subscriptions/upgrade-quote',{body:{planCode:'pro'}})).body.quote;
  const pending=await checkout(f,{...request('pro','late-upgrade-0001'),quoteId:quote.id});
  assert.equal(pending.status,201);
  f.sql.exec("UPDATE subscription_periods SET status='expired'");
  const result=await verify(pending,5000);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.orderStatus,'manual_review');
  assert.equal(result.body.paymentConfirmed,true);
  assert.equal(result.body.entitlementApplied,false);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_tier_changes').get().n,0);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM subscription_payment_events').get().n,2);
  assert.equal((await checkout(f,request('ultra','blocked-while-review'))).calls,0);
 }finally{f.sql.close();}
});

test('original-order access isolates users and an unauthenticated catalog never advertises disabled checkout',async()=>{
 const f=ready();
 try{
  f.env.SUBSCRIPTION_CHECKOUT_ENABLED='0';
  const off=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.equal(off.body.checkoutAvailable,false);
  assert.deepEqual(off.body.paymentMethods,[]);
  f.env.SUBSCRIPTION_CHECKOUT_ENABLED='1';
  const on=await f.call('/v1/subscriptions/plans',{method:'GET'});
  assert.equal(on.body.checkoutAvailable,true);
  const order=await checkout(f);
  const route='/v1/subscriptions/orders/'+order.body.order.id;
  assert.equal((await f.call(route,{method:'GET'})).body.order.checkout.paymentUrl,order.body.order.checkout.paymentUrl);
  const list=await f.call('/v1/subscriptions/orders',{method:'GET'});
  assert.equal(list.body.orders[0].checkout.paymentUrl,null);
  f.sql.exec("INSERT INTO users(id,email,status,created_at,email_verified_at) VALUES('other','other@test.example','active',1,1)");
  f.sql.prepare("UPDATE subscription_orders SET user_id='other' WHERE id=?").run(order.body.order.id);
  assert.equal((await f.call(route,{method:'GET'})).status,404);
  assert.equal((await f.call('/v1/subscriptions/orders',{method:'GET'})).body.orders.length,0);
 }finally{f.sql.close();}
});

test('trusted refund of an unstarted renewal never activates it or corrupts the current period',async()=>{
 const f=ready();
 try{
  const verify=(order,status,amount,refund)=>withProvider(()=>Response.json({code:1,data:{
   out_trade_no:order.outTrade,trade_no:'MK99_paid_'+order.outTrade,trade_status:status,
   total_amount:(amount/100).toFixed(2),...(refund?{refund_amount:(refund/100).toFixed(2)}:{}),
   pid:merchant,paytype_code:'alipay',currency:'CNY'
  }}),()=>f.call('/v1/subscriptions/orders/'+order.body.order.id+'/refresh',{method:'POST'}));
  const first=await checkout(f);
  assert.equal((await verify(first,'TRADE_SUCCESS',6990)).status,200);
  const next=await checkout(f,request('pro','queued-refund-0001'));
  assert.equal((await verify(next,'TRADE_SUCCESS',11990)).body.period.status,'queued');
  const returned=await verify(next,'TRADE_REFUND',11990,11990);
  assert.equal(returned.status,200);
  assert.equal(returned.body.orderStatus,'refunded');
  assert.equal((await verify(next,'TRADE_REFUND',11990,11990)).body.orderStatus,'refunded');
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_payment_events WHERE event_type='TRADE_REFUND'").get().n,1);
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.dailyLimit,500);
  assert.equal((await checkout(f,request('max','replacement-renewal-0001'))).status,201);
  assert.equal(metrics(f).credits,0);
 }finally{f.sql.close();}
});

test('concurrent quotes for different tiers can yield only one MK99 create',async()=>{
 const f=ready();
 try{
  const initial=await checkout(f);
  const paid=await withProvider(()=>Response.json({code:1,data:{
   out_trade_no:initial.outTrade,trade_no:'MK99_paid_'+initial.outTrade,trade_status:'TRADE_SUCCESS',
   total_amount:'69.90',pid:merchant,paytype_code:'alipay',currency:'CNY'
  }}),()=>f.call('/v1/subscriptions/orders/'+initial.body.order.id+'/refresh',{method:'POST'}));
  assert.equal(paid.status,200);
  const [pro,max]=await Promise.all(['pro','max'].map(planCode=>f.call('/v1/subscriptions/upgrade-quote',{body:{planCode}})));
  await withProvider(req=>{
   const params=Object.fromEntries(new URLSearchParams(req.body));
   return Response.json({code:1,data:{trade_no:'MK99_'+params.out_trade_no,out_trade_no:params.out_trade_no,pay_url:origins+'/pay'}});
  },async calls=>{
   const results=await Promise.all([
    f.call('/v1/subscriptions/orders',{body:{...request('pro','race-quote-pro'),quoteId:pro.body.quote.id}}),
    f.call('/v1/subscriptions/orders',{body:{...request('max','race-quote-max'),quoteId:max.body.quote.id}})
   ]);
   assert.deepEqual(results.map(result=>result.status).sort(),[201,409]);
   assert.equal(calls.length,1);
  });
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_upgrade_quotes WHERE order_id IS NOT NULL").get().n,1);
  assert.equal(f.sql.prepare("SELECT count(*) n FROM subscription_tier_changes").get().n,0);
 }finally{f.sql.close();}
});
