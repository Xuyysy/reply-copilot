import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {createHmac} from 'node:crypto';
import {fixture,withProvider} from './helpers/payment-v2.mjs';

const NETWORKS=[
 ['TRC20',6,'T'+'1'.repeat(33),'f'.repeat(64)],
 ['POLYGON',6,'0x'+'a'.repeat(40),'0x'+'b'.repeat(64)],
 ['BEP20',18,'0x'+'a'.repeat(40),'0x'+'c'.repeat(64)]
];
const secret='test-only-boltutil-secret-never-live';
function setup(){
 const f=fixture();
 f.sql.exec(readFileSync(new URL('../sql-proposals/0028_boltutil_usdt.sql',import.meta.url),'utf8'));
 Object.assign(f.env,{
   SUBSCRIPTIONS_ENABLED:'1',SUBSCRIPTION_PURCHASES_ENABLED:'1',
   BOLTUTIL_ENABLED:'1',BOLTUTIL_SCHEMA_READY:'1',
   BOLTUTIL_STAGING_CREATE_ENABLED:'1',BOLTUTIL_API_KEY:'test-bolt-key',
   BOLTUTIL_WEBHOOK_SECRET:secret,BOLTUTIL_CNY_PER_USDT_MICROS:'7000000',
   BOLTUTIL_TRC20_ENABLED:'1',BOLTUTIL_POLYGON_ENABLED:'1',
   BOLTUTIL_BEP20_ENABLED:'1'
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
     assert.deepEqual(r.body.networks,['TRC20','POLYGON','BEP20']);
   }
   f.env.BOLTUTIL_BEP20_ENABLED='0';
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
