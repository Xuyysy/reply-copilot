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
// Isolated local fixture: explicit operator permission is a second gate in Production.
function approveProductionOperatorFixture(f){
 const keys=['boltutil_operator_enabled',...NETWORKS.map(([network])=>'boltutil_operator_'+network.toLowerCase())];
 for(const key of keys)
   f.sql.prepare("INSERT INTO system_settings(key,value,updated_at) VALUES(?,'1',1) ON CONFLICT(key) DO UPDATE SET value='1'").run(key);
}
function approveProductionEvidenceFixture(f){
 f.env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED='1';
 f.env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED='1';
 f.env.BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS=f.env.BOLTUTIL_CNY_PER_USDT_MICROS;
}
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
     const pendingFeature=await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'});
     assert.equal(pendingFeature.body.features.interactionMomentum.eligible,false,'pending USDT cannot unlock momentum');
     const paid=await refresh(f,order);
     assert.equal(paid.status,200,JSON.stringify(paid.body));
     assert.equal(paid.body.order.entitlementApplied,true);
     const feature=await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'});
     assert.equal(feature.body.features.interactionMomentum.eligible,true,'settled USDT credit pack unlocks momentum');
     assert.equal((await f.call('/v1/creator-momentum/insights',{method:'GET'})).status,200);
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
     const feature=await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'});
     assert.equal(feature.body.features.interactionMomentum.eligible,true,'active USDT subscription unlocks momentum');
     assert.equal((await f.call('/v1/creator-momentum/insights',{method:'GET'})).status,200);
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

test('Production paid USDT queued renewal activates only after expiry and one verified BoltUtil event',async()=>{
 const f=setup();
 try{
  f.env.ENVIRONMENT='production';
  f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED='1';
  approveProductionEvidenceFixture(f);
  approveProductionOperatorFixture(f);
  const first=await create(f,'TRC20','subscription','basic');
  assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal((await refresh(f,first.body.order)).status,200);
  const second=await create(f,'POLYGON','subscription','pro');
  assert.equal(second.status,201,JSON.stringify(second.body));
  assert.equal((await refresh(f,second.body.order)).status,200);
  const queued=row(f,"SELECT id,start_at,end_at FROM subscription_periods WHERE status='queued'");
  assert.ok(queued?.id);
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.plan,'basic');
  const old=row(f,"SELECT id,start_at,end_at FROM subscription_periods WHERE status='active'");
  f.sql.prepare("UPDATE subscription_periods SET start_at=?,end_at=? WHERE id=?")
    .run(old.start_at-30*86400000-1000,old.end_at-30*86400000-1000,old.id);
  const after=await f.call('/v1/usage',{method:'GET'});
  assert.equal(after.status,200,JSON.stringify(after.body));
  assert.equal(after.body.subscription.plan,'pro');
  const active=row(f,"SELECT id,end_at-start_at duration FROM subscription_periods WHERE status='active'");
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

test('Staging cross-rail blocker endpoint includes old fiat, USDT and paid queued renewal without creating new provider invoices',async()=>{
 const f=setup();
 try{
  const now=Date.now(),fiatId='55555555-5555-4555-8555-555555555555';
  f.sql.prepare("INSERT INTO subscription_orders(id,user_id,plan_version_id,kind,amount_fen,status,quoted_at,quote_expires_at,created_at,updated_at,operation_id) VALUES(?,'test-user','basic-v1','purchase',6990,'pending',?,?,?,?,?)")
    .run(fiatId,now,now+300000,now,now,'fiat-pending-source');
  f.sql.prepare("INSERT INTO subscription_payment_transactions(id,order_id,merchant_provider,merchant_account,provider_trade_id,payment_channel,amount_fen,notification_sign_type,status,created_at,updated_at) VALUES(?,?,'mk99','merchant','trade-555','ALIPAY_H5',6990,'MD5','pending',?,?)")
    .run('fiat-tx-555',fiatId,now,now);
  const fiat=await f.call('/v1/boltutil/subscription-blockers',{method:'GET'});
  assert.equal(fiat.status,200,JSON.stringify(fiat.body));
  assert.deepEqual(fiat.body.orders.map(o=>[o.id,o.rail,o.status]),[[fiatId,'fiat','pending']]);
  f.sql.prepare("UPDATE subscription_orders SET status='closed' WHERE id=?").run(fiatId);
  const first=await create(f,'POLYGON','subscription','basic');
  assert.equal(first.status,201,JSON.stringify(first.body));
  const paid=await refresh(f,first.body.order);
  assert.equal(paid.status,200,JSON.stringify(paid.body));
  const next=await create(f,'TRC20','subscription','pro');
  assert.equal(next.status,201,JSON.stringify(next.body));
  const confirmed=await refresh(f,next.body.order);
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  const queued=f.sql.prepare("SELECT status FROM subscription_periods WHERE source_order_id=?").get(next.body.order.subscriptionOrderId);
  assert.equal(queued.status,'queued');
  const blockers=await f.call('/v1/boltutil/subscription-blockers',{method:'GET'});
  assert.equal(blockers.status,200,JSON.stringify(blockers.body));
  const record=blockers.body.orders.find(x=>x.subscriptionOrderId===next.body.order.subscriptionOrderId);
  assert.ok(record,JSON.stringify(blockers.body));
  assert.equal(record.id,next.body.order.id);
  assert.equal(record.rail,'usdt');
  assert.equal(record.status,'queued');
  const attempts=f.sql.prepare("SELECT count(*) n FROM boltutil_orders").get().n;
  assert.equal(attempts,2,'read-only blocker lookup must not create another invoice');
  f.env.ENVIRONMENT='production';
  // Read-only cross-rail recovery is allowed for a schema-ready Production
  // deployment even when new invoice creation is switched off.
  assert.equal((await f.call('/v1/boltutil/subscription-blockers',{method:'GET'})).status,200);
  f.env.BOLTUTIL_SCHEMA_READY='0';
  assert.equal((await f.call('/v1/boltutil/subscription-blockers',{method:'GET'})).status,404);
 }finally{f.sql.close();}
});

test('Production five-network checkout stays fail-closed until a separate explicit Production create bit is granted',async()=>{
 const f=setup();
 try{
  f.env.ENVIRONMENT='production';
  delete f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED;
  let contacts=0;
  const gone=await withProvider(()=>{contacts++;throw Error('must never create a merchant invoice');},()=>create(f,'POLYGON'));
  assert.equal(gone.status,503,JSON.stringify(gone.body));
  assert.equal(contacts,0);
  assert.equal(count(f,'boltutil_orders'),0);
  assert.equal((await f.call('/v1/boltutil/availability',{method:'GET'})).body.available,false);

  f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED='1';
  approveProductionEvidenceFixture(f);
  // Even after operator approval, all other live readiness controls are mandatory.
  for(const [name,value] of [['BOLTUTIL_SCHEMA_READY','0'],['BOLTUTIL_API_KEY',''],['BOLTUTIL_WEBHOOK_SECRET',''],['BOLTUTIL_CNY_PER_USDT_MICROS','']]){
   const prior=f.env[name];f.env[name]=value;
   assert.equal((await f.call('/v1/boltutil/availability',{method:'GET'})).body.available,false,'required '+name);
   f.env[name]=prior;
  }
  // Staging flag is irrelevant in Production. Even a ready Worker ceiling
  // cannot open real sales until the independent audited operator gate is armed.
  f.env.BOLTUTIL_STAGING_CREATE_ENABLED='0';
  assert.deepEqual((await f.call('/v1/boltutil/availability',{method:'GET'})).body.networks,[]);
  approveProductionOperatorFixture(f);
  assert.deepEqual((await f.call('/v1/boltutil/availability',{method:'GET'})).body.networks,
   ['TRC20','POLYGON','BEP20','ERC20','SOLANA']);
  const created=await create(f,'ERC20');
  assert.equal(created.status,201,JSON.stringify(created.body));
  const original=created.body.order;
  // Owner must be able to reconcile already created orders even during a sales freeze.
  f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED='0';
  f.env.BOLTUTIL_ENABLED='0';
  assert.equal((await f.call('/v1/boltutil/availability',{method:'GET'})).body.available,false);
  assert.equal((await f.call('/v1/boltutil/orders/'+original.id,{method:'GET'})).status,200);
  const verified=await refresh(f,original);
  assert.equal(verified.status,200,JSON.stringify(verified.body));
  assert.equal(verified.body.order.entitlementApplied,true);
  const replay=await refresh(f,original);
  assert.equal(replay.status,200,JSON.stringify(replay.body));
  assert.equal(count(f,'boltutil_payment_events'),1);
  assert.equal(row(f,"SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,1);
  assert.equal((await create(f,'SOLANA')).status,503,'creation must stay off after settlement');
 }finally{f.sql.close();}
});

test('Production webhook rejects uninitialized D1 and keeps signed original-order settlement after sales pause',async()=>{
 const f=setup();
 try{
  f.env.ENVIRONMENT='production';
  f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED='1';
  approveProductionEvidenceFixture(f);
  approveProductionOperatorFixture(f);
  const created=await create(f,'SOLANA');
  assert.equal(created.status,201,JSON.stringify(created.body));
  const order=created.body.order;
  const event={eventId:'production_evt_20261116',status:'CONFIRMED',
   amount:order.amount,paidAmount:order.amount,shortfallAmount:'0',
   settlementType:'EXACT',manuallyAccepted:false,currency:'USDT',
   network:'SOLANA',externalOrderId:row(f,'SELECT external_order_id FROM boltutil_orders WHERE id=?',order.id).external_order_id,
   destinationAddress:order.address,txHash:NETWORKS.find(n=>n[0]==='SOLANA')[3]};
  const signed=async()=>{const ts=String(Date.now()),sig=createHmac('sha256',secret)
   .update(ts+'.'+JSON.stringify(event)).digest('hex');
   return f.call('/v1/boltutil/webhook',{body:event,headers:{
    'X-Bolt-Webhook-Timestamp':ts,'X-Bolt-Webhook-Signature':sig
   }});
  };
  f.env.BOLTUTIL_SCHEMA_READY='0';
  assert.equal((await signed()).status,404,'never acknowledge a production webhook without schema');
  f.env.BOLTUTIL_SCHEMA_READY='1';
  f.env.BOLTUTIL_ENABLED='0';f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED='0';
  const confirmed=await withProvider(request=>{
   assert.equal(new URL(request.url).pathname,'/api/v1/order/status');
   return Response.json({code:200,data:event});
  },signed);
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  assert.equal(row(f,'SELECT paid_balance FROM credit_accounts WHERE user_id=?','test-user').paid_balance,400);
  assert.equal(count(f,'boltutil_payment_events'),1);
 }finally{f.sql.close();}
});


test('BoltUtil momentum access requires provider-confirmed completed credit settlement, not checkout or arbitrary balance',async()=>{
 const f=setup();try{
  const created=await create(f,'TRC20');
  assert.equal(created.status,201);
  const eligible=async()=>{const r=await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'});return r.body.features?.interactionMomentum?.eligible===true;};
  assert.equal(await eligible(),false);
  assert.equal((await refresh(f,created.body.order,{status:'PENDING'})).status,200);
  assert.equal(await eligible(),false);
  assert.equal((await refresh(f,created.body.order)).status,200);
  assert.equal(await eligible(),true);
  const cases=[
   ["UPDATE boltutil_orders SET status='manual_review'","UPDATE boltutil_orders SET status='paid'"],
   ["UPDATE boltutil_orders SET applied_at=NULL","UPDATE boltutil_orders SET applied_at=paid_at"],
   ["UPDATE boltutil_orders SET paid_usdt_micros=0","UPDATE boltutil_orders SET paid_usdt_micros=payable_usdt_micros"],
   ["UPDATE recharge_orders SET credited_at=NULL","UPDATE recharge_orders SET credited_at=paid_at"],
   ["UPDATE credit_batches SET status='refund_pending' WHERE source_kind='purchase'","UPDATE credit_batches SET status='active' WHERE source_kind='purchase'"]
  ];
  for(const [hold,restore] of cases){f.sql.exec(hold);assert.equal(await eligible(),false,'held or incomplete settlement denies');f.sql.exec(restore);assert.equal(await eligible(),true);}
  f.sql.exec('DELETE FROM boltutil_payment_events');
  assert.equal(await eligible(),false,'missing provider proof denies');
 }finally{f.sql.close();}
});
test('BoltUtil momentum stays fail closed when crypto schema disabled or account frozen',async()=>{
 const f=setup();try{
  const created=await create(f,'POLYGON');
  assert.equal((await refresh(f,created.body.order)).status,200);
  const eligible=async()=>{const r=await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'});return r.body.features?.interactionMomentum?.eligible===true;};
  f.env.BOLTUTIL_SCHEMA_READY='0';assert.equal(await eligible(),false);
  f.env.BOLTUTIL_SCHEMA_READY='1';assert.equal(await eligible(),true);
  f.sql.exec("UPDATE users SET status='frozen'");assert.equal(await eligible(),false);
 }finally{f.sql.close();}
});
test('BoltUtil active subscription momentum access requires active period and settled order',async()=>{
 const f=setup();try{
  const created=await create(f,'BEP20','subscription','basic');
  assert.equal((await refresh(f,created.body.order)).status,200);
  const eligible=async()=>{const r=await f.call('/v1/entitlements?feature=interactionMomentum',{method:'GET'});return r.body.features?.interactionMomentum?.eligible===true;};
  assert.equal(await eligible(),true);
  f.sql.exec("UPDATE boltutil_orders SET status='manual_review'");assert.equal(await eligible(),false);
  f.sql.exec("UPDATE boltutil_orders SET status='paid'");assert.equal(await eligible(),true);
  f.sql.exec("UPDATE subscription_periods SET status='revoked'");assert.equal(await eligible(),false);
 }finally{f.sql.close();}
});


function enableFiatSwitchFixture(f){
  Object.assign(f.env,{
    SUBSCRIPTION_CHECKOUT_ENABLED:'1',
    MK99_PID:'20881234567890',MK99_KEY:'local-fixture-not-a-real-merchant-key',
    MK99_REQUEST_SIGN_TYPE:'MD5',MK99_NOTIFY_SIGN_TYPE:'MD5',
    MK99_PROTOCOL_CONFIRMED:'1',MK99_AMOUNT_CONTRACT:'CNY_EXACT_BUYER_TOTAL',
    MK99_CASHIER_ORIGINS:'https://cashier.example.test'
  });
  f.sql.exec("UPDATE system_settings SET value='mk99' WHERE key='active_merchant'");
  f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_mk99_enabled','payment_mk99_alipay_enabled','payment_mk99_alipay_released','payment_mk99_wechat_enabled','payment_mk99_wechat_released')");
}
function unpaidBoltTerminalResponse(request,order,changes={}){
  assert.equal(new URL(request.url).pathname,'/api/v1/order/status');
  assert.equal(JSON.parse(request.body).externalOrderId,
    order.externalOrderId);
  return Response.json({code:200,data:{
    externalOrderId:order.externalOrderId,status:'CANCELLED',
    amount:order.amount,paidAmount:null,shortfallAmount:null,
    settlementType:null,manuallyAccepted:false,txHash:null,
    paidAt:null,confirmedAt:null,completedAt:null,
    currency:'USDT',network:order.network,destinationAddress:order.address,...changes
  }});
}
function fiatCreateResponse(request){
  assert.equal(new URL(request.url).pathname,'/openapi/pay/create');
  const params=Object.fromEntries(new URLSearchParams(request.body));
  return Response.json({code:1,data:{
    trade_no:'MK99_paid_'+params.out_trade_no,out_trade_no:params.out_trade_no,
    pay_url:'https://cashier.example.test/pay/'+params.out_trade_no
  }});
}
function originalBolt(f,created){
  const item=created.body.order;
  return {...item,externalOrderId:row(f,'SELECT external_order_id FROM boltutil_orders WHERE id=?',item.id).external_order_id};
}
async function newFiatCheckout(f,provider,order,attempt){
  let fiatCreates=0,statusQueries=0;
  const result=await withProvider(request=>{
    const pathname=new URL(request.url).pathname;
    if(pathname==='/api/v1/order/status'){statusQueries++;return unpaidBoltTerminalResponse(request,order,provider);}
    fiatCreates++;return fiatCreateResponse(request);
  },()=>f.call('/v1/subscriptions/orders',{body:{
    planCode:'basic',channel:'ALIPAY_H5',idempotencyKey:'fiat-after-crypto-'+attempt
  }}));
  return {...result,fiatCreates,statusQueries};
}

test('BEP20 provider CANCELLED/FAILED/EXPIRED releases only unpaid subscription and permits Alipay checkout',async()=>{
 for(const status of ['CANCELLED','FAILED','EXPIRED']){
  const f=setup();try{
   enableFiatSwitchFixture(f);
   const initial=await create(f,'BEP20','subscription','basic');
   assert.equal(initial.status,201,JSON.stringify(initial.body));
   const old=originalBolt(f,initial);
   if(status==='EXPIRED')f.sql.prepare('UPDATE boltutil_orders SET expires_at=? WHERE id=?').run(Date.now()-1,old.id);
   const switched=await newFiatCheckout(f,{status},old,status.toLowerCase());
   assert.equal(switched.status,201,JSON.stringify(switched.body));
   assert.equal(switched.statusQueries,status==='EXPIRED'?0:1,'expired invoices are closed by local 30-minute policy; other statuses query the provider');
   assert.equal(switched.fiatCreates,1);
   assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',old.id).status,'closed');
   assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',old.subscriptionOrderId).status,'closed');
   assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',switched.body.order.id).status,'pending');
   assert.equal(count(f,'subscription_payment_transactions'),1);
   assert.equal(count(f,'subscription_periods'),0);
   assert.equal(count(f,'boltutil_payment_events'),0);
   assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
  }finally{f.sql.close();}
 }
});

test('provider still pending, PAID, CONFIRMED, mismatched identity or partial transfer never releases pending USDT subscription',async()=>{
 const cases=[
  {name:'PENDING',provider:{status:'PENDING'}},
  {name:'PAID',provider:{status:'PAID',paidAmount:'1.000'}},
  {name:'CONFIRMED',provider:{status:'CONFIRMED',paidAmount:'1.000'}},
  {name:'wrong-network',provider:{network:'TRC20'}},
  {name:'wrong-order',provider:{externalOrderId:'OTHER_ORDER_123456'}},
  {name:'wrong-address',provider:{destinationAddress:'0x'+'f'.repeat(40)}},
  {name:'wrong-amount',provider:{amount:'1234.123'}},
  {name:'partial-payment',provider:{paidAmount:'0.100'}},
  {name:'has-tx-hash',provider:{txHash:'0x'+'a'.repeat(64)}},
  {name:'manual-settlement',provider:{settlementType:'MANUAL_UNDERPAID'}},
  {name:'expired-but-local-window-open',provider:{status:'EXPIRED'}}
 ];
 for(const entry of cases){
  const f=setup();try{
   enableFiatSwitchFixture(f);
   const created=await create(f,'BEP20','subscription','basic');
   assert.equal(created.status,201);
   const old=originalBolt(f,created);
   const attempt=await newFiatCheckout(f,entry.provider,old,entry.name);
   assert.equal(attempt.status,409,entry.name+':'+JSON.stringify(attempt.body));
   assert.equal(attempt.fiatCreates,0,entry.name+' must not reach fiat provider');
   assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',old.id).status,'pending',entry.name);
   assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',old.subscriptionOrderId).status,'pending',entry.name);
   assert.equal(count(f,'subscription_payment_transactions'),0);
   assert.equal(count(f,'subscription_periods'),0);
  }finally{f.sql.close();}
 }
});

test('USDT retry can create a new invoice on another network after BoltUtil confirms prior cancellation',async()=>{
 const f=setup();try{
  const old=originalBolt(f,await create(f,'TRC20','subscription','basic'));
  let queries=0,creates=0;
  const result=await withProvider(request=>{
   if(new URL(request.url).pathname==='/api/v1/order/status'){
    queries++;return unpaidBoltTerminalResponse(request,old);
   }
   creates++;return mockCreate(request);
  },()=>f.call('/v1/boltutil/orders',{body:{
   productType:'subscription',sku:'basic',network:'POLYGON',idempotencyKey:crypto.randomUUID()
  }}));
  assert.equal(result.status,201,JSON.stringify(result.body));
  assert.equal(queries,1);assert.equal(creates,1);
  assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',old.id).status,'closed');
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',old.subscriptionOrderId).status,'closed');
  assert.equal(count(f,'boltutil_orders'),2);assert.equal(count(f,'subscription_orders'),2);
 }finally{f.sql.close();}
});

test('original USDT order refresh can reconcile provider cancellation and remains read-only on subsequent checks',async()=>{
 const f=setup();try{
  const old=originalBolt(f,await create(f,'BEP20','subscription','basic'));
  const closed=await withProvider(request=>unpaidBoltTerminalResponse(request,old),
    ()=>f.call('/v1/boltutil/orders/'+old.id+'/refresh',{body:{}}));
  assert.equal(closed.status,200,JSON.stringify(closed.body));
  assert.equal(closed.body.order.status,'closed');
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',old.subscriptionOrderId).status,'closed');
  assert.equal(count(f,'subscription_periods'),0);
  const again=await withProvider(request=>unpaidBoltTerminalResponse(request,old),
    ()=>f.call('/v1/boltutil/orders/'+old.id+'/refresh',{body:{}}));
  assert.equal(again.status,200,JSON.stringify(again.body));
  assert.equal(again.body.order.status,'closed');
 }finally{f.sql.close();}
});

test('late confirmed transfer after provider-closed USDT invoice records payment and holds review without a second entitlement',async()=>{
 const f=setup();try{
  enableFiatSwitchFixture(f);
  const old=originalBolt(f,await create(f,'BEP20','subscription','basic'));
  const switched=await newFiatCheckout(f,{status:'CANCELLED'},old,'late-ack');
  assert.equal(switched.status,201,JSON.stringify(switched.body));
  const event={eventId:'evt_late_bep20_001',status:'CONFIRMED',
    amount:old.amount,paidAmount:old.amount,shortfallAmount:'0',
    settlementType:'EXACT',manuallyAccepted:false,currency:'USDT',
    network:'BEP20',externalOrderId:old.externalOrderId,
    destinationAddress:old.address,txHash:NETWORKS[2][3]};
  const ts=String(Date.now()),raw=JSON.stringify(event);
  const signature=createHmac('sha256',secret).update(ts+'.'+raw).digest('hex');
  const result=await withProvider(request=>{
    assert.equal(new URL(request.url).pathname,'/api/v1/order/status');
    return Response.json({code:200,data:event});
  },()=>f.call('/v1/boltutil/webhook',{body:event,headers:{
    'X-Bolt-Webhook-Timestamp':ts,'X-Bolt-Webhook-Signature':signature
  }}));
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',old.id).status,'manual_review');
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',old.subscriptionOrderId).status,'manual_review');
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',switched.body.order.id).status,'pending');
  assert.equal(count(f,'boltutil_payment_events'),1);
  assert.equal(count(f,'subscription_periods'),0);
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
 }finally{f.sql.close();}
});

test('manual original-order refresh after late BoltUtil confirmation safely records review but grants no subscription',async()=>{
 const f=setup();try{
  const old=originalBolt(f,await create(f,'BEP20','subscription','basic'));
  const closed=await withProvider(req=>unpaidBoltTerminalResponse(req,old),
    ()=>f.call('/v1/boltutil/orders/'+old.id+'/refresh',{body:{}}));
  assert.equal(closed.status,200,JSON.stringify(closed.body));
  assert.equal(closed.body.order.status,'closed');
  const event={status:'CONFIRMED',amount:old.amount,paidAmount:old.amount,
    shortfallAmount:'0',settlementType:'EXACT',manuallyAccepted:false,
    currency:'USDT',network:'BEP20',externalOrderId:old.externalOrderId,
    destinationAddress:old.address,txHash:NETWORKS[2][3]};
  const late=await withProvider(req=>{
   assert.equal(new URL(req.url).pathname,'/api/v1/order/status');
   return Response.json({code:200,data:event});
  },()=>f.call('/v1/boltutil/orders/'+old.id+'/refresh',{body:{}}));
  assert.equal(late.status,200,JSON.stringify(late.body));
  assert.equal(late.body.order.status,'manual_review');
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',old.subscriptionOrderId).status,'manual_review');
  assert.equal(count(f,'boltutil_payment_events'),1);
  assert.equal(count(f,'subscription_periods'),0);
  assert.equal((await f.call('/v1/usage',{method:'GET'})).body.subscription.status,'none');
 }finally{f.sql.close();}
});


test('local 30-minute expiry closes unpaid USDT credits without touching fiat payments or granting a credit',async()=>{
 const f=setup();try{
  const old=await create(f,'POLYGON','credits','starter');
  assert.equal(old.status,201,JSON.stringify(old.body));
  const id=old.body.order.id;
  const creditId=old.body.order.creditOrderId;
  assert.equal((await f.call('/v1/boltutil/expire',{method:'POST',body:'{}'})).body.closed,0,'unexpired stays payable');
  assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',id).status,'pending');
  f.sql.prepare("UPDATE boltutil_orders SET expires_at=? WHERE id=?").run(Date.now()-1,id);
  const expired=await f.call('/v1/boltutil/expire',{method:'POST',body:'{}'});
  assert.equal(expired.status,200,JSON.stringify(expired.body));
  assert.equal(expired.body.closed,1);
  assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',id).status,'closed');
  assert.equal(row(f,'SELECT status FROM recharge_orders WHERE id=?',creditId).status,'expired');
  assert.equal(row(f,"SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,0);
  assert.equal((await f.call('/v1/boltutil/orders/'+id,{method:'GET'})).body.order.checkoutUrl,null);
  assert.equal((await f.call('/v1/boltutil/expire',{method:'POST',body:'{}'})).body.closed,0,'idempotent close');
  const next=await create(f,'BEP20','credits','starter');
  assert.equal(next.status,201,JSON.stringify(next.body));
  assert.notEqual(next.body.order.id,id);
  assert.equal(count(f,'boltutil_orders'),2);
 }finally{f.sql.close();}
});
test('local expiry releases unpaid USDT subscription for Alipay even when BoltUtil still says PENDING',async()=>{
 const f=setup();try{
  enableFiatSwitchFixture(f);
  const usdt=await create(f,'BEP20','subscription','basic');
  assert.equal(usdt.status,201,JSON.stringify(usdt.body));
  const id=usdt.body.order.id,subId=usdt.body.order.subscriptionOrderId;
  let upstream=0;
  f.sql.prepare("UPDATE boltutil_orders SET expires_at=? WHERE id=?").run(Date.now()-1,id);
  const res=await withProvider(request=>{upstream++;throw Error('Expiry is entirely local; never call BoltUtil status');},
    ()=>f.call('/v1/boltutil/expire',{method:'POST',body:'{}'}));
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(res.body.closed,1);
  assert.equal(upstream,0);
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',subId).status,'closed');
  let fiatCreates=0,queries=0;
  const next=await withProvider(request=>{
   if(new URL(request.url).pathname==='/api/v1/order/status'){queries++;throw Error('Old USDT invoice must not block new fiat order');}
   fiatCreates++;return fiatCreateResponse(request);
  },()=>f.call('/v1/subscriptions/orders',{body:{planCode:'basic',channel:'ALIPAY_H5',idempotencyKey:'local-expiry-to-alipay-001'}}));
  assert.equal(next.status,201,JSON.stringify(next.body));
  assert.equal(fiatCreates,1);assert.equal(queries,0);
  assert.equal(count(f,'subscription_periods'),0);
  assert.equal(count(f,'boltutil_payment_events'),0);
 }finally{f.sql.close();}
});
test('local expiry does not close an unexpired, paid, event-backed or review-held BoltUtil invoice',async()=>{
 const f=setup();try{
  const paid=await create(f,'TRC20','credits','starter');
  assert.equal((await refresh(f,paid.body.order)).status,200);
  assert.equal(paid.status,201);
  f.sql.prepare("UPDATE boltutil_orders SET expires_at=? WHERE id=?").run(Date.now()-1,paid.body.order.id);
  const expired=await f.call('/v1/boltutil/expire',{method:'POST',body:'{}'});
  assert.equal(expired.status,200,JSON.stringify(expired.body));
  assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',paid.body.order.id).status,'paid');
  assert.equal(row(f,'SELECT status FROM recharge_orders WHERE id=?',paid.body.order.creditOrderId).status,'paid');
 }finally{f.sql.close();}
});
test('locally expired USDT credit pack receiving late verified payment remains held and never credits account',async()=>{
 const f=setup();try{
  const created=await create(f,'BEP20','credits','starter');
  assert.equal(created.status,201);
  const original=created.body.order;
  f.sql.prepare("UPDATE boltutil_orders SET expires_at=? WHERE id=?").run(Date.now()-1,original.id);
  assert.equal((await f.call('/v1/boltutil/expire',{method:'POST',body:'{}'})).body.closed,1);
  const late=await refresh(f,original);
  assert.equal(late.status,200,JSON.stringify(late.body));
  assert.equal(late.body.order.status,'manual_review');
  assert.equal(row(f,'SELECT status FROM recharge_orders WHERE id=?',original.creditOrderId).status,'expired');
  assert.equal(count(f,'boltutil_payment_events'),1,'late money evidence is retained');
  assert.equal(row(f,"SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,0,'never grant a closed credit invoice');
  assert.equal(row(f,"SELECT COUNT(*) n FROM credit_batches WHERE source_order_id=?",original.creditOrderId).n,0,'never create paid credit batch for closed invoice');
 }finally{f.sql.close();}
});

test('owner may cancel an unpaid unexpired USDT credit invoice without provider access and repurchase safely',async()=>{
 const f=setup();try{
  const initial=await create(f,'BEP20','credits','starter');
  assert.equal(initial.status,201,JSON.stringify(initial.body));
  const id=initial.body.order.id;
  let remoteCalls=0;
  const cancelled=await withProvider(()=>{remoteCalls++;throw Error('local cancel must not contact provider');},
    ()=>f.call('/v1/boltutil/orders/'+id+'/cancel',{body:{confirm:true}}));
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.order.status,'closed');
  assert.equal(remoteCalls,0);
  assert.equal(row(f,'SELECT status FROM recharge_orders WHERE id=?',initial.body.order.creditOrderId).status,'expired');
  assert.equal(row(f,"SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").n,0);
  const newOrder=await create(f,'POLYGON','credits','starter');
  assert.equal(newOrder.status,201,JSON.stringify(newOrder.body));
  assert.notEqual(newOrder.body.order.id,id);
 }finally{f.sql.close();}
});
test('unpaid unexpired USDT subscription can be cancelled locally and switched to Alipay checkout',async()=>{
 const f=setup();try{
  enableFiatSwitchFixture(f);
  const initial=await create(f,'TRC20','subscription','basic');
  assert.equal(initial.status,201,JSON.stringify(initial.body));
  const id=initial.body.order.id;
  const cancelled=await f.call('/v1/boltutil/orders/'+id+'/cancel',{body:{confirm:true}});
  assert.equal(cancelled.status,200,JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.order.status,'closed');
  assert.equal(row(f,'SELECT status FROM subscription_orders WHERE id=?',initial.body.order.subscriptionOrderId).status,'closed');
  let upstreamCreate=0,upstreamStatus=0;
  const fiat=await withProvider(request=>{
    if(new URL(request.url).pathname==='/api/v1/order/status'){upstreamStatus++;throw Error('no need to poll cancelled old USDT');}
    upstreamCreate++;return fiatCreateResponse(request);
  },()=>f.call('/v1/subscriptions/orders',{body:{
    planCode:'basic',channel:'ALIPAY_H5',idempotencyKey:'manual-cancel-to-alipay-001'
  }}));
  assert.equal(fiat.status,201,JSON.stringify(fiat.body));
  assert.equal(upstreamCreate,1);assert.equal(upstreamStatus,0);
  assert.equal(count(f,'subscription_periods'),0);
 }finally{f.sql.close();}
});
test('owner cannot cancel a paid USDT invoice or an invoice with transaction evidence',async()=>{
 const f=setup();try{
  const created=await create(f,'POLYGON','credits','starter');
  assert.equal(created.status,201);
  const id=created.body.order.id;
  assert.equal((await f.call('/v1/boltutil/orders/'+id+'/cancel',{body:{confirm:false}})).status,400);
  assert.equal((await refresh(f,created.body.order)).status,200);
  const denied=await f.call('/v1/boltutil/orders/'+id+'/cancel',{body:{confirm:true}});
  assert.equal(denied.status,409,JSON.stringify(denied.body));
  assert.equal(row(f,'SELECT status FROM boltutil_orders WHERE id=?',id).status,'paid');
  assert.equal(row(f,'SELECT status FROM recharge_orders WHERE id=?',created.body.order.creditOrderId).status,'paid');
 }finally{f.sql.close();}
});
