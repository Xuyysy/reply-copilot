import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {fixture,withProvider} from './helpers/payment-v2.mjs';
const url='/v1/admin/boltutil/test-orders';
const id='11111111-1111-4111-8111-111111111111';
const external='BOLTTEST_aaaaaaaaaaaaaaaaaaaaaaaa';
const secret='diagnostic-test-only-not-merchant-secret';
const key='local-test-only-fake-api-key';
function setup({admin=true}={}){
 const f=fixture();
 f.sql.exec(readFileSync(new URL('../sql-proposals/0029_boltutil_admin_mainnet_test.sql',import.meta.url),'utf8'));
 if(admin){
  f.sql.prepare("UPDATE users SET role='admin' WHERE id='test-user'").run();
  f.sql.prepare("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)").run();
  f.sql.prepare("INSERT INTO admin_reauth_sessions(session_id,expires_at) VALUES('test-session',?)").run(Date.now()+60000);
 }
 Object.assign(f.env,{ADMIN_PORTAL_ENABLED:'1',BOLTUTIL_ADMIN_TEST_SCHEMA_READY:'1',BOLTUTIL_ADMIN_TEST_ENABLED:'1',
  BOLTUTIL_API_KEY:key,BOLTUTIL_WEBHOOK_SECRET:secret,BOLTUTIL_ENABLED:'0',BOLTUTIL_STAGING_CREATE_ENABLED:'0'});
 f.sql.prepare("INSERT INTO boltutil_admin_test_orders (id,external_order_id,operation_id,admin_user_id,network,requested_usdt_micros,token_contract,status,created_at,updated_at) VALUES(?,?,?,?,?,1000000,?,'unknown',?,?)")
  .run(id,external,'22222222-2222-4222-8222-222222222222','test-user','POLYGON',
     '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',Date.now(),Date.now());
 return f;
}
function reply(body,code=200){return Response.json(body,{status:code});}
test('read-only probe checks API key then original status using timestamp+raw-body HMAC',async()=>{
 const f=setup();let hits=0;try{
  const res=await withProvider(r=>{
   hits++;
   assert.equal(r.headers.get('X-Bolt-Key'),key);
   const p=new URL(r.url).pathname;
   if(hits===1){
    assert.equal(r.method,'GET');assert.equal(p,'/api/v1/ping');
    assert.equal(r.headers.has('X-Bolt-Signature'),false);
    return reply({code:200,data:{ok:true}});
   }
   assert.equal(r.method,'POST');assert.equal(p,'/api/v1/order/status');
   assert.deepEqual(JSON.parse(r.body),{externalOrderId:external});
   const ts=r.headers.get('X-Bolt-Timestamp');
   assert.match(ts,/^\d{13}$/);
   const expected=createHmac('sha256',secret).update(ts+'.'+r.body).digest('hex');
   assert.equal(r.headers.get('X-Bolt-Signature'),expected);
   return reply({code:200,data:{externalOrderId:external,status:'PENDING',currency:'USDT',network:'POLYGON'}});
  },()=>f.call(url+'/'+id+'/diagnose',{body:{}}));
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(hits,2);
  assert.equal(res.body.readOnly,true);assert.equal(res.body.ping.kind,'ok');
  assert.equal(res.body.status.kind,'ok');assert.equal(res.body.status.orderStatus,'PENDING');
  assert.equal(res.body.localStatus,'unknown');assert.equal(res.body.hasLocalCheckout,false);
  assert.equal(f.sql.prepare("SELECT status FROM boltutil_admin_test_orders WHERE id=?").get(id).status,'unknown');
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM boltutil_admin_test_events").get().n,0);
  assert.doesNotMatch(JSON.stringify(res.body),new RegExp(secret+'|'+key));
 }finally{f.sql.close();}
});
test('read-only diagnosis reports 401 safely and does NOT query or create a provider order',async()=>{
 const f=setup();let calls=0;try{
  const res=await withProvider(r=>{calls++;assert.equal(new URL(r.url).pathname,'/api/v1/ping');return reply({code:401,message:'Sensitive merchant response, must not be returned'},401);},
   ()=>f.call(url+'/'+id+'/diagnose',{body:{}}));
  assert.equal(res.status,200);assert.equal(calls,1);
  assert.equal(res.body.ping.kind,'unauthorized');
  assert.equal(res.body.ping.httpStatus,401);
  assert.equal(res.body.status,null);
  assert.equal(res.body.nextStep,'fix_api_key_or_connectivity');
  assert.doesNotMatch(JSON.stringify(res.body),/Sensitive merchant response/);
 }finally{f.sql.close();}
});
test('merchant not-found for original order is surfaced, not turned into payment success',async()=>{
 const f=setup();let calls=0;try{
  const r=await withProvider(req=>{
   calls++;
   if(calls===1)return reply({code:200});
   assert.equal(new URL(req.url).pathname,'/api/v1/order/status');
   return reply({code:404,message:'order not found'},404);
  },()=>f.call(url+'/'+id+'/diagnose',{body:{}}));
  assert.equal(r.status,200);assert.equal(r.body.status.kind,'not_found');
  assert.equal(r.body.nextStep,'verify_merchant_order_not_found');
  assert.equal(f.sql.prepare("SELECT status FROM boltutil_admin_test_orders WHERE id=?").get(id).status,'unknown');
 }finally{f.sql.close();}
});
test('ordinary user cannot execute merchant diagnostics',async()=>{
 const f=setup({admin:false});try{
  const r=await f.call(url+'/'+id+'/diagnose',{body:{}});
  assert.equal(r.status,403,JSON.stringify(r.body));
 }finally{f.sql.close();}
});
test('diagnostics do not change the public USDT checkout flag, URLs or create endpoints',async()=>{
 const f=setup();try{
  const res=await f.call('/v1/boltutil/availability',{method:'GET'});
  assert.equal(res.status,200);assert.equal(res.body.available,false);
  const s=readFileSync(new URL('../src/boltutil/admin-probes.ts',import.meta.url),'utf8');
  const diag=s.slice(s.indexOf('export async function adminBoltTestDiagnose'));
  assert.doesNotMatch(diag,/order\/create|UPDATE boltutil_admin_test_orders|INSERT INTO boltutil_admin_test_orders/);
 }finally{f.sql.close();}
});
test('Staging admin UI offers diagnostics without asking to create more invoices',()=>{
 const src=readFileSync(new URL('../../web/src/components/admin/AdminBoltUtilPanel.tsx',import.meta.url),'utf8');
 assert.match(src,/只读诊断：为何没有收银台/);
 assert.match(src,/尚未确认创建成功，没有支付链接/);
});
