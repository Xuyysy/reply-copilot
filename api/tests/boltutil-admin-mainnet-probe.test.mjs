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

test('BoltUtil create 400 and business-code rejection are stored as sanitized diagnostic without leaking merchant body',async()=>{
 for(const [status,body,expected] of [
  [400,{code:40102,message:'SECRET_UNTRUSTED_DO_NOT_ECHO'},'CREATE_HTTP_HTTP_400_CODE_40102'],
  [200,{code:40909,message:'SECRET_UNTRUSTED_DO_NOT_ECHO'},'CREATE_BUSINESS_HTTP_200_CODE_40909']
 ]){
   const f=setup();try{
     const r=await withProvider(req=>{
       assert.equal(new URL(req.url).pathname,'/api/v1/order/create');
       return Response.json(body,{status});
     },()=>f.call(route,{body:req('TRC20')}));
     assert.equal(r.status,202,JSON.stringify(r.body));
     assert.equal(r.body.order.status,'unknown');
     assert.equal(r.body.order.providerStatus,expected);
     assert.doesNotMatch(JSON.stringify(r.body),/SECRET_UNTRUSTED_DO_NOT_ECHO/);
     assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders").get().n,1);
   }finally{f.sql.close();}
 }
});
test('BoltUtil create connection timeout retains unknown with sanitized failure type',async()=>{
 const f=setup();try{
   const r=await withProvider(()=>{throw Error('secret internal transport details');},
     ()=>f.call(route,{body:req('BEP20')}));
   assert.equal(r.status,202);
   assert.equal(r.body.order.providerStatus,'CREATE_NETWORK_HTTP_NA_CODE_NA');
   assert.doesNotMatch(JSON.stringify(r.body),/secret internal/);
 }finally{f.sql.close();}
});
test('BoltUtil malformed create invoice payload is not exposed and never grants benefits',async()=>{
 const f=setup();try{
   const r=await withProvider(()=>Response.json({code:200,data:{merchantExternalId:'wrong-id',checkoutUrl:'http://malicious.test'}}),
     ()=>f.call(route,{body:req('POLYGON')}));
   assert.equal(r.status,202);
   assert.equal(r.body.order.providerStatus,'CREATE_LOCAL_RESPONSE_VALIDATION_FAILED');
   assert.equal(r.body.order.checkoutUrl,null);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);
 }finally{f.sql.close();}
});

test('Staging admin can create more than three real-mainnet diagnostics in a day with no count or frequency restriction',async()=>{
 const f=setup();try{
  const ids=new Set();
  await withProvider(mockCreate,async()=>{
    for(let i=0;i<7;i++){
      const r=await f.call(route,{body:req('POLYGON',crypto.randomUUID())});
      assert.equal(r.status,201,JSON.stringify(r.body));
      assert.equal(r.body.order.network,'POLYGON');
      ids.add(r.body.order.id);
    }
  });
  assert.equal(ids.size,7);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders").get().n,7);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders WHERE network='POLYGON' AND status='pending'").get().n,7);
  assert.equal((await f.call('/v1/boltutil/availability',{method:'GET'})).body.available,false);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_events").get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);
 }finally{f.sql.close();}
});
test('Prior unknown Polygon test does not block another Polygon or TRC20 test; operationId remains idempotent',async()=>{
 const f=setup();try{
   const oldOp=crypto.randomUUID(),newOp=crypto.randomUUID();
   const old=await withProvider(()=>{throw Error('simulated timeout');},()=>f.call(route,{body:req('POLYGON',oldOp)}));
   assert.equal(old.status,202);assert.equal(old.body.order.status,'unknown');
   const next=await withProvider(mockCreate,()=>f.call(route,{body:req('POLYGON',newOp)}));
   assert.equal(next.status,201,JSON.stringify(next.body));
   assert.notEqual(next.body.order.id,old.body.order.id);
   const duplicate=await f.call(route,{body:req('POLYGON',newOp)});
   assert.equal(duplicate.status,200);
   assert.equal(duplicate.body.resumed,true);
   assert.equal(duplicate.body.order.id,next.body.order.id);
   const third=await withProvider(mockCreate,()=>f.call(route,{body:req('TRC20',crypto.randomUUID())}));
   assert.equal(third.status,201,JSON.stringify(third.body));
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_orders").get().n,3);
   assert.equal(f.sql.prepare("SELECT status FROM boltutil_admin_test_orders WHERE id=?").get(old.body.order.id).status,'unknown');
 }finally{f.sql.close();}
});
test('Admin tests are explicitly unlimited but still enforce positive identity verification and 1-USDT amount safeguards',()=>{
 const code=readFileSync(new URL('../src/boltutil/admin-probes.ts',import.meta.url),'utf8');
 const method=code.slice(code.indexOf('export async function adminBoltTestCreate'),code.indexOf('async function reconcile'));
 assert.doesNotMatch(method,/created_at\s*>\s*\?|COUNT\(\*\).*<3|status IN \('creating','pending','unknown','manual_review'\)|bolt-admin-test-create:/);
 assert.match(method,/requireAdminSession\(request,env,true\)/);
 assert.match(method,/I_ACCEPT_REAL_1_USDT_MAINNET/);
 assert.match(method,/micros>1100000n/);
 assert.match(method,/operation_id=\?/);
});

test('Staging 400 create reasons are mapped to fixed safe hints, never raw merchant details',async()=>{
 for(const [message,expected] of [
  ['Polygon receiving wallet not configured','WALLET_CONFIG'],
  ['Webhook is not enabled','WEBHOOK_CONFIG'],
  ['Network POLYGON is unavailable','NETWORK_ASSET'],
  ['Minimum amount is 2 USDT','AMOUNT_MINIMUM'],
  ['externalOrderId already exists','DUPLICATE_ORDER'],
  ['Invalid HMAC signature','SIGNATURE'],
  ['Daily quota reached','RATE_QUOTA'],
  ['unexpected error with API_KEY=secret_do_not_echo',null]
 ]){
  const f=setup();try{
   const r=await withProvider(()=>Response.json({code:400,message},{status:400}),
    ()=>f.call(route,{body:req('POLYGON')}));
   assert.equal(r.status,202);
   const label=r.body.order.providerStatus;
   assert.equal(label,'CREATE_HTTP_HTTP_400_CODE_400'+(expected?'_REASON_'+expected:''));
   assert.equal(r.body.order.status,'unknown');
   assert.equal(r.body.order.checkoutUrl,null);
   assert.doesNotMatch(JSON.stringify(r.body),/secret_do_not_echo|Polygon receiving wallet not configured|Webhook is not enabled|Network POLYGON is unavailable/);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);
  }finally{f.sql.close();}
 }
});


test('Expanded BoltUtil error classification understands inactive merchant setup and nested error messages without leaking raw response',async()=>{
 const cases=[
  [{code:400,error:{message:'No active wallet for POLYGON, token=secret_raw_wallet'}},'WALLET_CONFIG'],
  [{code:400,data:{message:'Merchant webhook is inactive'}},'WEBHOOK_CONFIG'],
  [{code:400,message:'No enabled network for USDT POLYGON'},'NETWORK_ASSET'],
  [{code:400,detail:'Minimum amount must be greater than 1 USDT'},'AMOUNT_MINIMUM'],
  [{code:400,error:'External order ID already exists'},'DUPLICATE_ORDER'],
  [{code:400,msg:'Invalid HMAC signature'},'SIGNATURE'],
  [{code:400,msg:'Daily request quota exceeded'},'RATE_QUOTA'],
  [{code:400,error:{message:'unclassified raw server: password=secret_raw_wallet'}},null]
 ];
 for(const [payload,expected] of cases){
  const f=setup();try{
   const res=await withProvider(()=>Response.json(payload,{status:400}),
      ()=>f.call(route,{body:req('POLYGON')}));
   assert.equal(res.status,202);
   assert.equal(res.body.order.providerStatus,'CREATE_HTTP_HTTP_400_CODE_400'+(expected?'_REASON_'+expected:''));
   assert.equal(res.body.order.checkoutUrl,null);
   assert.doesNotMatch(JSON.stringify(res.body),/secret_raw_wallet|password=|No active wallet|Merchant webhook is inactive/);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM credit_ledger WHERE kind='purchase_grant'").get().n,0);
  }finally{f.sql.close();}
 }
});
test('Staging admin checkout UX shows a real provider link only after validated invoice, and a merchant configuration checklist on HTTP 400',()=>{
 const source=readFileSync(new URL('../../web/src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');
 assert.match(source,/admin-boltutil-checkout-blocked/);
 assert.match(source,/admin-boltutil-checkout-ready/);
 assert.match(source,/BoltUtil 拒绝了创建订单/);
 assert.match(source,/真实 BoltUtil 付款页面已生成/);
 assert.match(source,/result.order.status==="pending"&&!!result.order.checkoutUrl/);
 assert.match(source,/o.checkoutUrl&&o.status==="pending"&&o.address&&o.amount/);
 assert.match(source,/https:\/\/boltutil\.com\/developer-docs\?s=create/);
});
