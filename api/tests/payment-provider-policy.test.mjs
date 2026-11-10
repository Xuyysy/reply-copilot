import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,pbkdf2Sync} from 'node:crypto';
import {fixture,withProvider,providerResponse,enableEpaySales} from './helpers/payment-v2.mjs';

function adminFixture(){
  const f=fixture({released:false});f.env.ADMIN_PORTAL_ENABLED='1';f.env.PASSWORD_PEPPER='payment-policy-test-pepper';
  const salt='1234567890abcdef1234567890abcdef',hash=pbkdf2Sync('ExampleAdmin123!\0'+f.env.PASSWORD_PEPPER,Buffer.from(salt,'hex'),100000,32,'sha256').toString('hex');
  f.sql.prepare("UPDATE users SET role='admin',password_hash=? WHERE id='test-user'").run(`pbkdf2-sha256:100000:${salt}:${hash}`);
  f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
  f.sql.prepare("INSERT INTO admin_reauth_sessions VALUES('test-session',?)").run(Date.now()+900000);
  return f;
}
const op=()=>({operationId:randomUUID(),reason:'确认支付通道配置和平台开通状态'});

test('migration adds channel snapshot and safe provider defaults without overwriting operator purchase setting',()=>{
 const f=fixture({released:false});
 assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value,'1');
 assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='payment_rsa2_enabled'").get().value,'1');
 assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='payment_epay_enabled'").get().value,'0');
 assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='payment_alipay_released'").get().value,'0');
 assert.ok(f.sql.prepare("PRAGMA table_info(payment_transactions)").all().some(x=>x.name==='payment_channel'));
 f.sql.close();
});

test('RSA2 Alipay is not exposed until its own channel and release gates are enabled',async()=>{
 const f=fixture({released:false});
 let r=await f.call('/v1/packages',{method:'GET'});
 assert.equal(r.body.paymentAvailable,false);assert.deepEqual(r.body.paymentMethods,[]);
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key='payment_rsa2_alipay_enabled'");
 r=await f.call('/v1/packages',{method:'GET'});
 assert.equal(r.body.paymentAvailable,false);assert.deepEqual(r.body.paymentMethods,[]);
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key='payment_rsa2_alipay_released'");
 r=await f.call('/v1/packages',{method:'GET'});
 assert.equal(r.body.paymentAvailable,true);assert.deepEqual(r.body.paymentMethods,[{provider:'xiaodou',channel:'ALIPAY_H5'}]);
 f.sql.close();
});

test('WeChat is not exposed until its own platform-release gate is enabled',async()=>{
 const f=fixture({released:false});
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key='payment_rsa2_wechat_enabled'");
 let r=await f.call('/v1/packages',{method:'GET'});
 assert.equal(r.body.paymentAvailable,false);assert.deepEqual(r.body.paymentMethods,[]);
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key='payment_rsa2_wechat_released'");
 r=await f.call('/v1/packages',{method:'GET'});
 assert.equal(r.body.paymentAvailable,true);assert.deepEqual(r.body.paymentMethods,[{provider:'xiaodou',channel:'WECHAT_H5'}]);
 f.sql.close();
});

test('Alipay is preferred first when both RSA2 channels are confirmed',async()=>{
 const f=fixture();
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_alipay_enabled','payment_rsa2_alipay_released','payment_rsa2_wechat_enabled','payment_rsa2_wechat_released')");
 const r=await f.call('/v1/packages',{method:'GET'});
 assert.equal(r.body.paymentAvailable,true);
 assert.deepEqual(r.body.paymentMethods,[
  {provider:'xiaodou',channel:'ALIPAY_H5'},
  {provider:'xiaodou',channel:'WECHAT_H5'},
 ]);
 let requestedChannel=null;
 await withProvider(captured=>{
  requestedChannel=JSON.parse(captured.body).channel;
  return providerResponse(captured,{channel:requestedChannel});
 },async()=>{
  const created=await f.call('/v1/orders',{body:{packageId:'starter'}});
  assert.equal(created.status,201);
 });
 assert.equal(requestedChannel,'WECHAT_H5');
 f.sql.close();
});

test('legacy Epay Alipay sales require only their own channel and release gates',async()=>{
 const f=enableEpaySales(fixture({released:false}));
 f.env.XIAODOU_EPAY_GATEWAY='https://gateway.example.test/submit.php';
 f.env.XIAODOU_EPAY_PID='12345';
 f.env.XIAODOU_EPAY_KEY='local-test-key';
 try {
  let r=await f.call('/v1/packages',{method:'GET'});
  assert.equal(r.body.paymentAvailable,false);
  assert.deepEqual(r.body.paymentMethods,[]);
  f.sql.exec("UPDATE system_settings SET value='1' WHERE key='payment_epay_alipay_released'");
  r=await f.call('/v1/packages',{method:'GET'});
  assert.equal(r.body.paymentAvailable,true);
  assert.deepEqual(r.body.paymentMethods,[{provider:'xiaodou_epay',channel:'ALIPAY_H5'}]);
 } finally { f.sql.close(); }
});

test('legacy admin can toggle providers with audit but cannot infer provider-specific Alipay approval',async()=>{
 const f=adminFixture();
 const before=await f.call('/v1/admin/payment-control',{method:'GET'});
 assert.equal(before.status,200);assert.equal(before.body.operatorEnabled,true);
 assert.equal(before.body.providers.rsa2.enabled,true);assert.equal(before.body.providers.epay.enabled,false);
 const body={...op(),settings:{rsa2Enabled:false,epayEnabled:true,alipayEnabled:true,wechatEnabled:true,alipayReleased:true,wechatReleased:false}};
 const saved=await f.call('/v1/admin/payment-control',{body});
 assert.equal(saved.status,200);assert.equal(saved.body.providers.rsa2.enabled,false);assert.equal(saved.body.providers.epay.enabled,true);
 assert.equal(saved.body.channels.rsa2.alipay.platformReleased,false,'legacy global release edits must not unlock RSA2 Alipay');
 assert.equal(saved.body.channels.epay.alipay.platformReleased,false,'legacy global release edits must not unlock Epay Alipay');
 assert.equal(saved.body.operatorEnabled,true);assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value,'1');
 assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_logs').get().n,1);
 f.sql.close();
});

test('new RSA2 order freezes requested channel; unavailable channels are rejected without writes',async()=>{
 const f=fixture();
 let r=await f.call('/v1/orders',{body:{packageId:'starter',channel:'WECHAT_H5'}});
 assert.equal(r.status,503);assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,0);
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_alipay_enabled','payment_rsa2_alipay_released')");
 await withProvider(captured=>providerResponse(captured,{channel:JSON.parse(captured.body).channel}),async()=>{r=await f.call('/v1/orders',{body:{packageId:'starter',channel:'ALIPAY_H5'}});});
 assert.equal(r.status,201);assert.equal(f.sql.prepare('SELECT payment_channel FROM payment_transactions').get().payment_channel,'ALIPAY_H5');
 f.sql.close();
});

test('RSA2 pending orders relaunch from their immutable protocol when the legacy env default is Epay',async()=>{
 const f=fixture();
 f.env.PAYMENT_PROVIDER='xiaodou_epay';
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_alipay_enabled','payment_rsa2_alipay_released')");
 let orderId;
 try {
  await withProvider(req=>providerResponse(req),async()=>{
   const created=await f.call('/v1/orders',{body:{packageId:'starter',channel:'ALIPAY_H5'}});
   assert.equal(created.status,201);
   orderId=created.body.order.id;
  });
  const before=f.sql.prepare('SELECT payment_protocol,status,provider_trade_id FROM payment_transactions WHERE order_id=?').get(orderId);
  assert.equal(before.payment_protocol,'rsa2');
  let calls=0;
  await withProvider(req=>{calls++;return providerResponse(req,{outTradeNo:before.provider_trade_id,amountFen:1006},{status:200});},async()=>{
   const result=await f.call(`/v1/orders/${orderId}/attempts`,{body:{}});
   assert.equal(result.status,201);
   assert.equal(result.body.paymentUrl,'https://cashier.example.test/pay/test');
  });
  assert.equal(calls,1);
  assert.equal(f.sql.prepare('SELECT payment_protocol,status FROM payment_transactions WHERE order_id=?').get(orderId).status,'pending');
 } finally { f.sql.close(); }
});

test('RSA2 refunds are not misclassified as legacy Epay by a stale provider environment default',async()=>{
 const f=adminFixture();
 f.env.PAYMENT_PROVIDER='xiaodou_epay';
 f.sql.exec("UPDATE system_settings SET value='1' WHERE key IN ('payment_rsa2_alipay_enabled','payment_rsa2_alipay_released')");
 let orderId;
 try {
  await withProvider(req=>providerResponse(req),async()=>{orderId=(await f.call('/v1/orders',{body:{packageId:'starter',channel:'ALIPAY_H5'}})).body.order.id;});
  const result=await f.call(`/v1/admin/orders/${orderId}/refunds`,{body:{baseAmountFen:990,serviceFeeAmountFen:0,creditsToRevoke:0,reason:'manual review test',confirm:true,creditAdjustmentConfirmed:true}});
  assert.equal(result.body.code,'ORDER_NOT_REFUNDABLE');
 } finally { f.sql.close(); }
});

test('Epay historical callback stays enabled when Epay new-sales toggle is off',async()=>{
 const f=fixture();f.env.PAYMENT_PROVIDER='xiaodou';
 assert.equal((await f.call('/v1/payments/xiaodou/epay/notify',{method:'GET'})).status!==404,true);
 f.sql.close();
});

test('admin read-only RSA2 reachability check verifies the platform response and never returns settlement data',async()=>{
 const f=adminFixture();let called=0;
 await withProvider(captured=>{called++;assert.equal(new URL(captured.url).pathname,'/api/open/v1/settlement/accounts');assert.equal(captured.method,'GET');assert.equal(captured.body,undefined);return providerResponse(captured,{accounts:[{accountName:'MUST_NOT_LEAK',bankTail:'1234'}]},{status:200});},async()=>{
  const result=await f.call('/v1/admin/payment-platform-check',{body:{}});assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(result.body.responseSignature,'verified');assert.equal(JSON.stringify(result.body).includes('MUST_NOT_LEAK'),false);assert.equal(JSON.stringify(result.body).includes('1234'),false);
 });
 assert.equal(called,1);f.sql.close();
});
