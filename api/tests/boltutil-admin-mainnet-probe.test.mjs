import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture,withProvider} from './helpers/payment-v2.mjs';
const networks=[
  ['TRC20',6,'T'+'1'.repeat(33),'a'.repeat(64)],
  ['POLYGON',6,'0x'+'2'.repeat(40),'0x'+'b'.repeat(64)],
  ['BEP20',18,'0x'+'3'.repeat(40),'0x'+'c'.repeat(64)]
];
function setup({admin=true,enabled=true}={}){
 const f=fixture();
 f.sql.exec(readFileSync(new URL('../sql-proposals/0029_boltutil_admin_mainnet_test.sql',import.meta.url),'utf8'));
 if(admin){
  f.sql.prepare("UPDATE users SET role='admin' WHERE id='test-user'").run();
  f.sql.prepare("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)").run();
  f.sql.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('test-session',?)").run(Date.now()+60000);
 }
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',BOLTUTIL_ADMIN_TEST_SCHEMA_READY:'1',
  BOLTUTIL_ADMIN_TEST_ENABLED:enabled?'1':'0',BOLTUTIL_API_KEY:'local-test-only',
  BOLTUTIL_WEBHOOK_SECRET:'local-test-only-secret',BOLTUTIL_ENABLED:'0',BOLTUTIL_STAGING_CREATE_ENABLED:'0'});
 return f;
}
const route='/v1/admin/boltutil/test-orders';
const req=(n,op=crypto.randomUUID())=>({network:n,operationId:op,confirm:'I_ACCEPT_REAL_1_USDT_MAINNET',reason:'Staging owner-authorized USDT diagnostic'});
function mockCreate(request){
 assert.equal(new URL(request.url).pathname,'/api/v1/order/create');
 const b=JSON.parse(request.body);
 assert.equal(b.amount,'1.00');assert.equal(b.currency,'USDT');
 assert.ok(b.notifyUrl.endsWith('/v1/boltutil/admin-test/webhook'));
 const [network,decimal,address]=networks.find(n=>n[0]===b.network);
 return Response.json({code:200,data:{
   merchantExternalId:b.externalOrderId,status:'PENDING',
   checkoutUrl:'https://boltutil.com/pay/'+b.externalOrderId,
   payment:{network,decimal,address,amount:'1.000001',currency:'USDT',
    rawAmount:(1000001n*(10n**BigInt(decimal-6))).toString()},
   time:{expireTimestamp:Date.now()+1800000,serverTimestamp:Date.now()}
 }});
}
async function create(f,n,op){return withProvider(mockCreate,()=>f.call(route,{body:req(n,op)}));}
function mockStatus(request,n,id,status='CONFIRMED',mismatch=false){
 assert.equal(new URL(request.url).pathname,'/api/v1/order/status');
 assert.deepEqual(JSON.parse(request.body),{externalOrderId:id});
 const [network,,address,txHash]=networks.find(x=>x[0]===n);
 return Response.json({code:200,data:{
  status,currency:'USDT',externalOrderId:id,network,amount:'1.000001',
  paidAmount:status==='CONFIRMED'?'1.000001':null,
  shortfallAmount:status==='CONFIRMED'?'0':null,
  settlementType:status==='CONFIRMED'?'EXACT':null,
  destinationAddress:mismatch?'0x'+'f'.repeat(40):address,
  txHash:status==='CONFIRMED'?txHash:null,manuallyAccepted:false
 }});
}
for(const [network] of networks){
 test(network+' admin-only 1 USDT provider-confirmed payment never grants credit or subscription',async()=>{
  const f=setup();try{
   const created=await create(f,network);assert.equal(created.status,201,JSON.stringify(created.body));
   const o=created.body.order;assert.equal(o.amount,'1.000001');assert.equal(o.noEntitlement,true);
   assert.equal((await f.call('/v1/boltutil/availability',{method:'GET'})).body.available,false);
   const confirmed=await withProvider(r=>mockStatus(r,network,o.externalOrderId),
    ()=>f.call(route+'/'+o.id+'/refresh',{body:{}}));
   assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));assert.equal(confirmed.body.order.status,'paid');
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_events").get().n,1);
   const again=await f.call(route+'/'+o.id+'/refresh',{body:{}});
   assert.equal(again.status,200);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_events").get().n,1);
   assert.equal(f.sql.prepare("SELECT paid_balance FROM credit_accounts WHERE user_id='test-user'").get().paid_balance,0);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM subscription_periods").get().n,0);
  }finally{f.sql.close();}
 });
}
test('ordinary user cannot list or create privileged USDT tests',async()=>{
 const f=setup({admin:false});try{
  assert.equal((await f.call(route,{method:'GET'})).status,403);
  assert.equal((await f.call(route,{body:req('TRC20')})).status,403);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders").get().n,0);
 }finally{f.sql.close();}
});
test('default-OFF test flag and explicit mainnet confirmation protect invoice creation',async()=>{
 const f=setup({enabled:false});try{
  assert.equal((await f.call(route,{method:'GET'})).body.enabled,false);
  assert.equal((await f.call(route,{body:req('TRC20')})).status,503);
  f.env.BOLTUTIL_ADMIN_TEST_ENABLED='1';
  assert.equal((await f.call(route,{body:{...req('TRC20'),confirm:'yes'}})).status,400);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders").get().n,0);
 }finally{f.sql.close();}
});
test('upstream timeout preserves idempotency key and unresolved original invoice ID',async()=>{
 const f=setup();try{
  const op=crypto.randomUUID();
  const first=await withProvider(()=>{throw Error('timeout');},()=>f.call(route,{body:req('TRC20',op)}));
  assert.equal(first.status,202,JSON.stringify(first.body));assert.equal(first.body.order.status,'unknown');
  const second=await f.call(route,{body:req('TRC20',op)});
  assert.equal(second.status,200);assert.equal(second.body.resumed,true);
  assert.equal(second.body.order.id,first.body.order.id);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders").get().n,1);
 }finally{f.sql.close();}
});
test('unconfirmed provider PAID remains pending; wrong address goes to manual review',async()=>{
 const f=setup();try{
  const c=await create(f,'BEP20');const o=c.body.order;
  const pending=await withProvider(r=>mockStatus(r,'BEP20',o.externalOrderId,'PAID'),
   ()=>f.call(route+'/'+o.id+'/refresh',{body:{}}));
  assert.equal(pending.status,200);assert.equal(pending.body.order.status,'pending');
  const wrong=await withProvider(r=>mockStatus(r,'BEP20',o.externalOrderId,'CONFIRMED',true),
   ()=>f.call(route+'/'+o.id+'/refresh',{body:{}}));
  assert.equal(wrong.status,409,JSON.stringify(wrong.body));
  assert.equal(f.sql.prepare("SELECT status FROM boltutil_admin_test_orders WHERE id=?").get(o.id).status,'manual_review');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);
 }finally{f.sql.close();}
});
test('probe SQL is isolated and bounded with no business-table writes',()=>{
 const sql=readFileSync(new URL('../sql-proposals/0029_boltutil_admin_mainnet_test.sql',import.meta.url),'utf8');
 assert.match(sql,/CREATE TABLE boltutil_admin_test_orders/);
 assert.match(sql,/requested_usdt_micros=1000000/);
 assert.doesNotMatch(sql,/ALTER TABLE|DROP TABLE|credit_ledger|subscription_periods/);
});
