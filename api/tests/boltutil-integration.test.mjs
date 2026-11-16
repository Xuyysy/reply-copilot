import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {createHmac} from 'node:crypto';
import {fixture,withProvider} from './helpers/payment-v2.mjs';

const NETWORKS=[
 ['TRC20',6,'T'+'1'.repeat(33),'f'.repeat(64)],
 ['POLYGON',6,'0x'+'a'.repeat(40),'0x'+'b'.repeat(64)],
 ['BEP20',18,'0x'+'a'.repeat(40),'0x'+'c'.repeat(64)],
 ['ERC20',6,'0x'+'a'.repeat(40),'0x'+'d'.repeat(64)],
 ['SOLANA',6,'4wBqpZM9xaSheZzJSMawUKKwhdpChKbZ5eu5ky4Vigw','2Ana1pUpv2ZbMVkwF5FXapYeBEjdxDatLn7nvJkhgTSXbs59SyZSx866bXirPgj8QQVB57uxHJBG1YFvkRbFj4T']
];
const secret='test-only-boltutil-secret-never-live';
function setup(){
 const f=fixture();
 f.sql.exec(readFileSync(new URL('../sql-proposals/0028_boltutil_usdt.sql',import.meta.url),'utf8'));
 f.sql.exec(readFileSync(new URL('../sql-proposals/0030_boltutil_five_networks_staging.sql',import.meta.url),'utf8'));
 Object.assign(f.env,{
   SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',
   BOLTUTIL_ENABLED:'1',BOLTUTIL_SCHEMA_READY:'1',
   BOLTUTIL_STAGING_CREATE_ENABLED:'1',BOLTUTIL_API_KEY:'test-bolt-key',
   BOLTUTIL_WEBHOOK_SECRET:secret,BOLTUTIL_CNY_PER_USDT_MICROS:'7000000',
   BOLTUTIL_TRC20_ENABLED:'1',BOLTUTIL_POLYGON_ENABLED:'1',
   BOLTUTIL_BEP20_ENABLED:'1',BOLTUTIL_ERC20_ENABLED:'1',
   BOLTUTIL_SOLANA_ENABLED:'1'
 });
 return f;
}
function row(f,sql,...args){return f.sql.prepare(sql).get(...args);}
function count(f,table){return Number(row(f,'SELECT count(*) n FROM '+table).n);}
function mockCreate(request){
 assert.equal(new URL(request.url).pathname,'/api/v1/order/create');
 const body=JSON.parse(request.body);
 assert.equal(body.currency,'USDT');
 const route=NETWORKS.find(x=>x[0]===body.network);
 assert.ok(route,'unknown chain');
 const [network,decimals,address]=route;
 const amount=body.amount;
 const [major,frac='']=amount.split('.');
 const micros=BigInt(major)*1000000n+BigInt((frac+'000000').slice(0,6));
 return Response.json({code:200,data:{
   merchantExternalId:body.externalOrderId,status:'PENDING',
   checkoutUrl:'https://boltutil.com/pay/'+body.externalOrderId,
   payment:{currency:'USDT',network,decimal:decimals,address,
     amount,rawAmount:(micros*(10n**BigInt(decimals-6))).toString()},
   time:{expireTimestamp:Date.now()+1800000,serverTimestamp:Date.now()}
 }});
}
async function create(f,network,productType='credits',sku='starter',more={}){
 return withProvider(mockCreate,()=>f.call('/v1/boltutil/orders',{
   body:{productType,sku,network,idempotencyKey:crypto.randomUUID(),...more}
 }));
}
async function refresh(f,order,opts={}){
 const [network,,address,txHash]=NETWORKS.find(x=>x[0]===order.network);
 return withProvider(request=>{
   assert.equal(new URL(request.url).pathname,'/api/v1/order/status');
   assert.deepEqual(JSON.parse(request.body),{externalOrderId:row(f,'SELECT external_order_id FROM boltutil_orders WHERE id=?',order.id).external_order_id});
   return Response.json({code:200,data:{
     status:opts.status??'CONFIRMED',amount:order.amount,paidAmount:opts.paidAmount??order.amount,
     shortfallAmount:opts.shortfallAmount??'0',settlementType:opts.settlementType??'EXACT',
     manuallyAccepted:false,currency:'USDT',network:opts.network??network,
     externalOrderId:row(f,'SELECT external_order_id FROM boltutil_orders WHERE id=?',order.id).external_order_id,
     destinationAddress:address,txHash:opts.txHash??txHash,
   }});
 },()=>f.call('/v1/boltutil/orders/'+order.id+'/refresh',{body:{}}));
}
for(const [network] of NETWORKS){
 test('BoltUtil '+network+' permanent credit checkout -> payment -> exactly-once grant',async()=>{
   const f=setup();
   try{
     const initial=await create(f,network);
     assert.equal(initial.status,201,JSON.stringify(initial.body));
     assert.equal(initial.body.order.status,'pending');
     assert.equal(initial.body.order.network,network);
     const expectedCny=row(f,'SELECT price_cny_fen FROM recharge_packages WHERE id=?','starter').price_cny_fen;
     assert.equal(row(f,'SELECT base_amount_fen FROM boltutil_orders WHERE id=?',initial.body.order.id).base_amount_fen,expectedCny,'USDT must not inherit MK99 fee uplift');
     const order=initial.body.order;
     const paid=await refresh(f,order);
     assert.equal(paid.status,200,JSON.stringify(paid.body));
     assert.equal(paid.body.order.entitlementApplied,true);
     const after=await refresh(f,order);
     assert.equal(after.status,200,JSON.stringify(after.body));
     assert.equal(row(f,'SELECT paid_balance FROM credit_accounts WHERE user_id=?','test-user').paid_balance,400);
     assert.equal(count(f,'credit_batches'),2); // signup + one paid purchase
     assert.equal(count(f,'boltutil_payment_events'),1);
     assert.equal(row(f,"SELECT count(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,1);
   }finally{f.sql.close();}
 });
 test('BoltUtil '+network+' subscription purchase -> verified 30-day quota, no paid credits',async()=>{
   const f=setup();
   try{
     const created=await create(f,network,'subscription','basic');
     assert.equal(created.status,201,JSON.stringify(created.body));
     const result=await refresh(f,created.body.order);
     assert.equal(result.status,200,JSON.stringify(result.body));
     assert.equal(result.body.order.entitlementApplied,true);
     const account=await f.call('/v1/usage',{method:'GET'});
     assert.equal(account.body.subscription.status,'active',JSON.stringify(account.body));
     assert.equal(account.body.subscription.dailyLimit,500);
     assert.equal(count(f,'subscription_periods'),1);
     assert.equal(row(f,'SELECT paid_balance FROM credit_accounts WHERE user_id=?','test-user').paid_balance,0);
   }finally{f.sql.close();}
 });
}
test('USDT availability unaffected by MK99/Xiaodou merchant toggle, but independently disabled',async()=>{
 const f=setup();
 try{
   for(const merchant of ['mk99','xiaodou','none']){
     f.sql.prepare("UPDATE system_settings SET value=? WHERE key='active_merchant'").run(merchant);
     const r=await f.call('/v1/boltutil/availability',{method:'GET'});
     assert.equal(r.body.available,true,JSON.stringify(r.body));
     assert.deepEqual(r.body.networks,['TRC20','POLYGON','BEP20','ERC20','SOLANA']);
   }
   f.env.BOLTUTIL_BEP20_ENABLED='0';
   assert.deepEqual((await f.call('/v1/boltutil/availability',{method:'GET'})).body.networks,['TRC20','POLYGON','ERC20','SOLANA']);
   f.env.BOLTUTIL_SOLANA_ENABLED='0';f.env.BOLTUTIL_ERC20_ENABLED='0';
   assert.deepEqual((await f.call('/v1/boltutil/availability',{method:'GET'})).body.networks,['TRC20','POLYGON']);
   f.env.BOLTUTIL_ENABLED='0';
   assert.equal((await f.call('/v1/boltutil/availability',{method:'GET'})).body.available,false);
 }finally{f.sql.close();}
});
test('pending provider status cannot grant entitlements',async()=>{
 const f=setup();
 try{
   const created=await create(f,'TRC20');
   assert.equal(created.status,201,JSON.stringify(created.body));
   const pending=await refresh(f,created.body.order,{status:'PAID'});
   assert.equal(pending.status,200,JSON.stringify(pending.body));
   assert.equal(row(f,'SELECT paid_balance FROM credit_accounts WHERE user_id=?','test-user').paid_balance,0);
 }finally{f.sql.close();}
});

test('TRON Basic subscription -> Polygon Pro upgrade keeps expiry and used quota',async()=>{
 const f=setup();
 try{
   const purchase=await create(f,'TRC20','subscription','basic');
   assert.equal(purchase.status,201,JSON.stringify(purchase.body));
   assert.equal((await refresh(f,purchase.body.order)).status,200);
   const old=row(f,"SELECT id,end_at,daily_limit FROM subscription_periods WHERE status='active'");
   assert.ok(old?.id);
   f.sql.prepare("INSERT INTO subscription_daily_usage(period_id,day_index,used,reserved,updated_at) VALUES(?,0,7,0,?)")
     .run(old.id,Date.now());
   const quoted=await f.call('/v1/boltutil/upgrade-quote',{body:{planCode:'pro'}});
   assert.equal(quoted.status,200,JSON.stringify(quoted.body));
   const upgrade=await create(f,'POLYGON','subscription','pro',{quoteId:quoted.body.quote.id});
   assert.equal(upgrade.status,201,JSON.stringify(upgrade.body));
   const paid=await refresh(f,upgrade.body.order);
   assert.equal(paid.status,200,JSON.stringify(paid.body));
   assert.equal(paid.body.order.entitlementApplied,true);
   const changed=row(f,"SELECT id,end_at,daily_limit FROM subscription_periods WHERE status='active'");
   assert.equal(changed.id,old.id);
   assert.equal(changed.end_at,old.end_at);
   assert.equal(changed.daily_limit,1000);
   assert.equal(row(f,'SELECT used FROM subscription_daily_usage WHERE period_id=? AND day_index=0',old.id).used,7);
   assert.equal(count(f,'subscription_tier_changes'),1);
   const usage=await f.call('/v1/usage',{method:'GET'});
   assert.equal(usage.body.subscription.dailyLimit,1000);
   assert.equal(usage.body.subscription.usedToday,7);
 }finally{f.sql.close();}
});
test('TRON Basic -> BSC Pro next-period renewal starts only after old 30-day period expires',async()=>{
 const f=setup();
 try{
   const first=await create(f,'TRC20','subscription','basic');
   assert.equal(first.status,201,JSON.stringify(first.body));
   assert.equal((await refresh(f,first.body.order)).status,200);
   const second=await create(f,'BEP20','subscription','pro');
   assert.equal(second.status,201,JSON.stringify(second.body));
   const paid=await refresh(f,second.body.order);
   assert.equal(paid.status,200,JSON.stringify(paid.body));
   const queued=row(f,"SELECT id,start_at,end_at FROM subscription_periods WHERE status='queued'");
   assert.ok(queued?.id);
   assert.equal(queued.start_at,null);
   assert.equal(queued.end_at,null);
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.plan,'basic');
   const old=row(f,"SELECT id,start_at,end_at FROM subscription_periods WHERE status='active'");
   f.sql.prepare("UPDATE subscription_periods SET start_at=?,end_at=? WHERE id=?")
    .run(old.start_at-30*86400000-1000,old.end_at-30*86400000-1000,old.id);
   const after=await f.call('/v1/usage',{method:'GET'});
   assert.equal(after.status,200,JSON.stringify(after.body));
   assert.equal(after.body.subscription.plan,'pro');
   assert.equal(after.body.subscription.dailyLimit,1000);
   const active=row(f,"SELECT id,end_at-start_at AS duration FROM subscription_periods WHERE status='active'");
   assert.equal(active.id,queued.id);
   assert.equal(active.duration,30*86400000);
 }finally{f.sql.close();}
});
test('a signed-looking but wrong-network provider confirmation triggers review without any entitlement',async()=>{
 const f=setup();
 try{
   const order=await create(f,'TRC20');
   assert.equal(order.status,201,JSON.stringify(order.body));
   const result=await refresh(f,order.body.order,{network:'BEP20'});
   assert.notEqual(result.status,200);
   assert.equal(row(f,'SELECT paid_balance FROM credit_accounts WHERE user_id=?','test-user').paid_balance,0);
   assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',order.body.order.id).status,'manual_review');
 }finally{f.sql.close();}
});

test('signed BoltUtil webhook validates raw body and replay id, then credits once',async()=>{
 const f=setup();
 try{
   const created=await create(f,'TRC20');
   assert.equal(created.status,201,JSON.stringify(created.body));
   const order=created.body.order;
   const event={eventId:'evt_1234567890abcdef',status:'CONFIRMED',
     amount:order.amount,paidAmount:order.amount,shortfallAmount:'0',
     settlementType:'EXACT',manuallyAccepted:false,currency:'USDT',
     network:'TRC20',externalOrderId:row(f,'SELECT external_order_id FROM boltutil_orders WHERE id=?',order.id).external_order_id,
     destinationAddress:order.address,txHash:NETWORKS[0][3]};
   async function send(payload,ts=String(Date.now()),signingPayload=payload){
     const raw=JSON.stringify(signingPayload);
     const sig=createHmac('sha256',secret).update(ts+'.'+raw).digest('hex');
     return f.call('/v1/boltutil/webhook',{body:payload,headers:{
       'X-Bolt-Webhook-Timestamp':ts,'X-Bolt-Webhook-Signature':sig
     }});
   }
   const mismatch=await send({...event,amount:'999'},undefined,event);
   assert.equal(mismatch.status,401);
   const expired=await send(event,String(Date.now()-3600000));
   assert.equal(expired.status,401);
   const result=await withProvider(request=>{
     const body=JSON.parse(request.body);
     assert.equal(body.externalOrderId,event.externalOrderId);
     return Response.json({code:200,data:event});
   },()=>send(event));
   assert.equal(result.status,200,JSON.stringify(result.body));
   const repeated=await send(event);
   assert.equal(repeated.status,200,JSON.stringify(repeated.body));
   assert.equal(count(f,'boltutil_payment_events'),1);
   assert.equal(row(f,'SELECT paid_balance FROM credit_accounts WHERE user_id=?','test-user').paid_balance,400);
 }finally{f.sql.close();}
});

test('concurrent unique checkout keys cannot create two pending subscription invoices',async()=>{
 const f=setup();
 try{
   const params={productType:'subscription',sku:'basic',network:'TRC20'};
   let providerCreates=0;
   const [one,two]=await withProvider(request=>{
     providerCreates++;
     return mockCreate(request);
   },()=>Promise.all([
     f.call('/v1/boltutil/orders',{body:{...params,idempotencyKey:crypto.randomUUID()}}),
     f.call('/v1/boltutil/orders',{body:{...params,idempotencyKey:crypto.randomUUID()}})
   ]));
   assert.deepEqual([one.status,two.status].sort((a,b)=>a-b),[201,409],
     JSON.stringify([one.body,two.body]));
   assert.equal(providerCreates,1,'losing checkout cannot call provider');
   assert.equal(count(f,'subscription_orders'),1);
   assert.equal(count(f,'boltutil_orders'),1);
 }finally{f.sql.close();}
});

test('one idempotency key cannot silently alias different chains during a race',async()=>{
 const f=setup();
 try{
   const idempotencyKey=crypto.randomUUID();
   const base={productType:'credits',sku:'starter',idempotencyKey};
   let calls=0;
   const [tron,bsc]=await withProvider(request=>{
     calls++;return mockCreate(request);
   },()=>Promise.all([
     f.call('/v1/boltutil/orders',{body:{...base,network:'TRC20'}}),
     f.call('/v1/boltutil/orders',{body:{...base,network:'BEP20'}})
   ]));
   assert.deepEqual([tron.status,bsc.status].sort((a,b)=>a-b),[201,409],
     JSON.stringify([tron.body,bsc.body]));
   assert.equal(count(f,'boltutil_orders'),1);
   assert.equal(calls,1);
 }finally{f.sql.close();}
});
test('concurrent same upgrade quote cannot issue two payable invoices',async()=>{
 const f=setup();
 try{
   const original=await create(f,'TRC20','subscription','basic');
   assert.equal(original.status,201,JSON.stringify(original.body));
   assert.equal((await refresh(f,original.body.order)).status,200);
   const q=await f.call('/v1/boltutil/upgrade-quote',{body:{planCode:'pro'}});
   assert.equal(q.status,200,JSON.stringify(q.body));
   const base={productType:'subscription',sku:'pro',network:'POLYGON',quoteId:q.body.quote.id};
   let calls=0;
   const [a,b]=await withProvider(request=>{calls++;return mockCreate(request);},()=>Promise.all([
     f.call('/v1/boltutil/orders',{body:{...base,idempotencyKey:crypto.randomUUID()}}),
     f.call('/v1/boltutil/orders',{body:{...base,idempotencyKey:crypto.randomUUID()}})
   ]));
   assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[201,409],JSON.stringify([a.body,b.body]));
   assert.equal(calls,1);
   assert.equal(count(f,'subscription_orders'),2); // original and one upgrade
   assert.equal(count(f,'boltutil_orders'),2);
 }finally{f.sql.close();}
});

for(const [network] of NETWORKS){
  for(const [plan,dailyLimit] of [['basic',500],['pro',1000],['max',1500],['ultra',2000]]){
    test(network+' '+plan+' entitlement matrix preserves all three credit ledgers',async()=>{
      const f=setup();
      try{
        f.sql.prepare("UPDATE system_settings SET value='none' WHERE key='active_merchant'").run();
        const order=await create(f,network,'subscription',plan);
        assert.equal(order.status,201,JSON.stringify(order.body));
        const result=await refresh(f,order.body.order);
        assert.equal(result.status,200,JSON.stringify(result.body));
        assert.equal(result.body.order.entitlementApplied,true);
        const usage=await f.call('/v1/usage',{method:'GET'});
        assert.equal(usage.body.subscription.plan,plan);
        assert.equal(usage.body.subscription.dailyLimit,dailyLimit);
        assert.equal(usage.body.subscription.remainingToday,dailyLimit);
        assert.equal(row(f,"SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").paid_balance,0);
        assert.equal(row(f,"SELECT free_balance FROM credit_accounts WHERE user_id='test-user'").free_balance,200);
        assert.equal(count(f,'credit_batches'),1);
      }finally{f.sql.close();}
    });
  }
}

test('Native on-site checkout needs only verified provider payment details, not a hosted checkout URL',async()=>{
 for(const network of ['TRC20','POLYGON','BEP20','ERC20','SOLANA']){
  const f=setup();
  try{
   const created=await withProvider(async request=>{
    const result=await mockCreate(request).json();
    delete result.data.checkoutUrl;
    return Response.json(result);
   },()=>f.call('/v1/boltutil/orders',{body:{
    productType:'credits',sku:'starter',network,idempotencyKey:crypto.randomUUID()
   }}));
   assert.equal(created.status,201,JSON.stringify(created.body));
   const o=created.body.order;
   assert.equal(o.status,'pending');
   assert.equal(o.checkoutUrl,null);
   assert.equal(o.network,network);
   assert.equal(typeof o.address,'string');
   assert.ok(o.amount&&o.expiresAt>Date.now());
   const grant=await refresh(f,o);
   assert.equal(grant.status,200,JSON.stringify(grant.body));
   assert.equal(grant.body.order.entitlementApplied,true);
   assert.equal(row(f,"SELECT COUNT(*) AS n FROM credit_ledger WHERE kind='purchase_grant'").n,1);
   assert.equal((await refresh(f,o)).body.order.entitlementApplied,true);
   assert.equal(row(f,"SELECT COUNT(*) AS n FROM credit_ledger WHERE kind='purchase_grant'").n,1);
  }finally{f.sql.close();}
 }
});
test('Untrusted hosted URLs and non-PENDING provider creation never enable native payment or grant credits',async()=>{
 for(const modification of [
  data=>{data.checkoutUrl='https://evil.example/steal';},
  data=>{data.checkoutUrl='javascript:alert(1)';},
  data=>{data.checkoutUrl='';},
  data=>{data.status='EXPIRED';},
  data=>{data.payment.address=data.payment.address.replace('a','b');data.payment.address='0x'+'0'.repeat(40);}
 ]){
  const f=setup();try{
   const result=await withProvider(async request=>{
    const created=await mockCreate(request).json();
    modification(created.data);
    return Response.json(created);
   },()=>f.call('/v1/boltutil/orders',{body:{
    productType:'credits',sku:'starter',network:'POLYGON',idempotencyKey:crypto.randomUUID()
   }}));
   assert.equal(result.status,202,JSON.stringify(result.body));
   assert.equal(result.body.order.status,'unknown');
   assert.equal(result.body.order.checkoutUrl,null);
   assert.equal(result.body.order.address,null);
   assert.equal(row(f,"SELECT COUNT(*) AS n FROM credit_ledger WHERE kind='purchase_grant'").n,0);
  }finally{f.sql.close();}
 }
});

test('Existing fiat subscription blocks USDT invoice without provider call; its original remains recoverable',async()=>{
 const f=setup();
 try{
  const now=Date.now(),oldId='22222222-2222-4222-8222-222222222222';
  f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,operation_id) VALUES(?,'test-user','basic-v1','purchase',6990,'pending',?,?,?,?,?)")
   .run(oldId,now,now+300000,now,now,'existing-fiat-order');
  f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,status,created_at,updated_at) VALUES(?,?,'mk99','test-mk99','test-fiat-trade','ALIPAY_H5',6990,'MD5','pending',?,?)")
   .run('fiat-tx',oldId,now,now);
  let providerCalls=0;
  const attempted=await withProvider(request=>{providerCalls++;return mockCreate(request);},()=>
    create(f,'POLYGON','subscription','pro'));
  assert.equal(attempted.status,409,JSON.stringify(attempted.body));
  assert.equal(attempted.body.code,'SUBSCRIPTION_PENDING_ORDER');
  assert.equal(providerCalls,0,'blocked new subscription must never request real provider invoice');
  assert.equal(count(f,'boltutil_orders'),0);
  const fiat=await f.call('/v1/subscriptions/orders',{method:'GET'});
  assert.equal(fiat.status,200);
  assert.equal(fiat.body.orders.find(o=>o.id===oldId)?.status,'pending');
  const usdt=await f.call('/v1/boltutil/orders',{method:'GET'});
  assert.equal(usdt.status,200);
  assert.deepEqual(usdt.body.orders,[],'old fiat invoice is intentionally not in BoltUtil list');
  assert.equal(count(f,'subscription_orders'),1,'old subscription preserved, no new payment');
 }finally{f.sql.close();}
});
