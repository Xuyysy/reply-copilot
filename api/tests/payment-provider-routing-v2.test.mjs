import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fixture,enableEpaySales} from './helpers/payment-v2.mjs';

const set=(f,values)=>{
 for(const [key,value] of Object.entries(values))f.sql.prepare('UPDATE system_settings SET value=? WHERE key=?').run(value?'1':'0',key);
};
const epayCredentials=f=>{
 f.env.XIAODOU_EPAY_GATEWAY='https://gateway.example.test/submit.php';
 f.env.XIAODOU_EPAY_PID='12345';
 f.env.XIAODOU_EPAY_KEY='test-only-key';
};

test('provider channel migration copies legacy values once and keeps interface-specific release state independent',()=>{
 const f=fixture({released:false});
 try{
  const read=key=>f.sql.prepare('SELECT value FROM system_settings WHERE key=?').get(key)?.value;
  assert.equal(read('payment_rsa2_alipay_enabled'),'1');
  assert.equal(read('payment_rsa2_wechat_enabled'),'0');
  assert.equal(read('payment_epay_alipay_enabled'),'1');
  assert.equal(read('payment_rsa2_alipay_released'),'0');
  assert.equal(read('payment_epay_alipay_released'),'0');
  f.sql.prepare("UPDATE system_settings SET value='0' WHERE key='payment_rsa2_alipay_enabled'").run();
  f.sql.prepare("UPDATE system_settings SET value='1' WHERE key='payment_epay_alipay_released'").run();
  f.sql.exec(readFileSync(new URL('../migrations/0014_provider_channel_independence.sql',import.meta.url),'utf8'));
  assert.equal(read('payment_rsa2_alipay_enabled'),'0','a safe migration replay must not overwrite an existing provider setting');
  assert.equal(read('payment_rsa2_alipay_released'),'0');
  assert.equal(read('payment_epay_alipay_released'),'1','a safe migration replay must not overwrite an operator release decision');
 }finally{f.sql.close();}
});

test('RSA2-only WeChat method is exposed only when its interface, channel, credentials and release are ready',async()=>{
 const f=fixture({released:false});f.env.XIAODOU_WECHAT_MERCHANT_APPROVED='1';
 try{
  set(f,{payment_rsa2_enabled:true,payment_rsa2_wechat_enabled:true,payment_rsa2_wechat_released:false});
  let result=await f.call('/v1/packages',{method:'GET'});
  assert.equal(result.body.paymentAvailable,false);assert.deepEqual(result.body.paymentMethods,[]);
  set(f,{payment_rsa2_wechat_released:true});
  result=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(result.body.paymentMethods,[{provider:'xiaodou',channel:'WECHAT_H5'}]);
 }finally{f.sql.close();}
});

test('new Xiaodou orders are RSA2-only even when Epay legacy settings are enabled',async()=>{
 const f=fixture({released:false});epayCredentials(f);f.env.XIAODOU_EPAY_TEST_COMPAT='0';
 try{
  set(f,{payment_rsa2_enabled:true,payment_rsa2_alipay_enabled:true,payment_rsa2_alipay_released:true,payment_epay_enabled:true,payment_epay_alipay_enabled:true,payment_epay_alipay_released:false});
  let result=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(result.body.paymentMethods,[{provider:'xiaodou',channel:'ALIPAY_H5'}]);
  set(f,{payment_rsa2_alipay_released:false,payment_epay_alipay_released:true});
  result=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(result.body.paymentMethods,[]);
  set(f,{payment_rsa2_enabled:false});
  result=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(result.body.paymentMethods,[]);
 }finally{f.sql.close();}
});

test('retired Epay cannot be used for new Alipay or WeChat orders',async()=>{
 const f=enableEpaySales(fixture({released:true}));epayCredentials(f);f.env.XIAODOU_EPAY_TEST_COMPAT='0';
 try{
  set(f,{payment_epay_alipay_enabled:true,payment_epay_alipay_released:true,payment_rsa2_enabled:false});
  const available=await f.call('/v1/packages',{method:'GET'});
  assert.deepEqual(available.body.paymentMethods,[]);
  const rejected=await f.call('/v1/orders',{body:{packageId:'starter',channel:'WECHAT_H5'}});
  assert.equal(rejected.status,503);
  assert.equal(f.sql.prepare('SELECT count(*) n FROM recharge_orders').get().n,0);
 }finally{f.sql.close();}
});

test('global purchase switch closes every new provider method without affecting historical Epay callbacks',async()=>{
 const f=fixture({released:true});epayCredentials(f);
 try{
  set(f,{payment_rsa2_alipay_enabled:true,payment_rsa2_alipay_released:true,payment_epay_enabled:true,payment_epay_alipay_enabled:true,payment_epay_alipay_released:true,purchase_enabled:false});
  const result=await f.call('/v1/packages',{method:'GET'});
  assert.equal(result.body.paymentAvailable,false);assert.deepEqual(result.body.paymentMethods,[]);
  f.sql.prepare("UPDATE payment_transactions SET payment_protocol='epay' WHERE id='nonexistent'").run();
  const notify=await f.call('/v1/payments/xiaodou/epay/notify',{method:'GET'});
  assert.notEqual(notify.status,404);
 }finally{f.sql.close();}
});

test('provider controls accept separate audited settings and return persisted values',async()=>{
 const f=fixture();f.env.ADMIN_PORTAL_ENABLED='1';
 try{
  f.sql.prepare("UPDATE users SET role='admin' WHERE id='test-user'").run();
  f.sql.exec("INSERT INTO site_administrator VALUES(1,'test-user',1)");
  f.sql.prepare('INSERT INTO admin_reauth_sessions VALUES(?,?)').run('test-session',Date.now()+900000);
  const response=await f.call('/v1/admin/payment-control',{body:{operationId:randomUUID(),reason:'Separate interface channel settings',settings:{rsa2Enabled:true,rsa2WechatEnabled:true,rsa2AlipayEnabled:false,rsa2WechatReleased:false,rsa2AlipayReleased:false,epayEnabled:false,epayAlipayEnabled:true,epayAlipayReleased:false}}});
  assert.equal(response.status,200);
  assert.equal(response.body.providers.rsa2.enabled,true);
  assert.equal(response.body.providers.epay.enabled,false);
  assert.equal(response.body.channels.rsa2.wechat.enabled,true);
  assert.equal(response.body.channels.epay.alipay.enabled,true);
  assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='purchase_enabled'").get().value,'1');
  assert.equal(f.sql.prepare('SELECT count(*) n FROM admin_audit_logs').get().n,1);
 }finally{f.sql.close();}
});
