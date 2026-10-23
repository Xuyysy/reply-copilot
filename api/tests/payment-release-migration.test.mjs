import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {fixture,withProvider} from './helpers/payment-v2.mjs';

const migrations=new URL('../migrations/',import.meta.url);
const splitSql=readFileSync(new URL('0014_provider_channel_independence.sql',migrations),'utf8');
const corrections=()=>readdirSync(migrations).filter(name=>name==='0015_conservative_alipay_release.sql').sort();
const correct=f=>{for(const name of corrections())f.sql.exec(readFileSync(new URL(name,migrations),'utf8'));};
const releaseKeys=['payment_rsa2_alipay_released','payment_epay_alipay_released'];
const releaseRows=f=>f.sql.prepare("SELECT * FROM system_settings WHERE key IN ('payment_rsa2_alipay_released','payment_epay_alipay_released') ORDER BY key").all();
const set=(f,key,value)=>f.sql.prepare('UPDATE system_settings SET value=? WHERE key=?').run(String(value),key);
const businessSnapshot=f=>Object.fromEntries(['recharge_orders','payment_transactions','payment_attempts','provider_payment_events','payment_events','credit_accounts','credit_batches','credit_ledger'].map(table=>[table,f.sql.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
function epayCredentials(f){
 f.env.XIAODOU_EPAY_GATEWAY='https://gateway.example.test/submit.php';
 f.env.XIAODOU_EPAY_PID='12345';f.env.XIAODOU_EPAY_KEY='local-test-only-key';
}
function admin(f){
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator VALUES(1,'test-user',1)");
 f.sql.prepare('INSERT INTO admin_reauth_sessions VALUES(?,?)').run('test-session',Date.now()+900000);
}
const settings=(rsa2Released,epayReleased)=>({rsa2Enabled:true,rsa2WechatEnabled:false,rsa2AlipayEnabled:true,rsa2WechatReleased:false,rsa2AlipayReleased:rsa2Released,epayEnabled:true,epayAlipayEnabled:true,epayAlipayReleased:epayReleased});
const legacySettings={rsa2Enabled:true,epayEnabled:true,alipayEnabled:true,wechatEnabled:false,alipayReleased:true,wechatReleased:false};

test('legacy Alipay release never authorizes either provider through incremental migration',async t=>{
 for(const legacy of [0,1])for(const rsa2 of [0,1])for(const epay of [0,1]){
  await t.test(`legacy=${legacy}, RSA2=${rsa2}, Epay=${epay}`,async()=>{
   const f=fixture({released:false});epayCredentials(f);
   try{
    set(f,'payment_alipay_released',legacy);set(f,'payment_rsa2_enabled',rsa2);set(f,'payment_epay_enabled',epay);
    for(const key of releaseKeys)f.sql.prepare('DELETE FROM system_settings WHERE key=?').run(key);
    f.sql.exec(splitSql);
    // Reproduce the already-shipped 0014 exactly, then only run forward fixes.
    assert.deepEqual(releaseRows(f).map(row=>row.value),[String(legacy),String(legacy)]);
    const before=businessSnapshot(f);
    correct(f);
    assert.deepEqual(releaseRows(f).map(row=>row.value),['0','0']);
    assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='payment_alipay_released'").get().value,String(legacy));
    assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='payment_rsa2_enabled'").get().value,String(rsa2));
    assert.equal(f.sql.prepare("SELECT value FROM system_settings WHERE key='payment_epay_enabled'").get().value,String(epay));
    await withProvider(()=>{throw new Error('unexpected provider call');},async calls=>{
     const available=await f.call('/v1/packages',{method:'GET'});
     assert.deepEqual(available.body.paymentMethods,[]);
     const order=await f.call('/v1/orders',{body:{packageId:'starter',channel:'ALIPAY_H5'}});
     assert.equal(order.status,503);assert.equal(calls.length,0);
    });
    assert.deepEqual(businessSnapshot(f),before,'migration and rejected checkout must not alter financial data');
   }finally{f.sql.close();}
  });
 }
});

test('missing provider release keys fail closed rather than falling back to legacy release',async()=>{
 const f=fixture({released:false});epayCredentials(f);
 try{
  set(f,'payment_alipay_released',1);set(f,'payment_epay_enabled',1);
  for(const key of releaseKeys)f.sql.prepare('DELETE FROM system_settings WHERE key=?').run(key);
  const result=await f.call('/v1/packages',{method:'GET'});
  assert.equal(result.body.paymentAvailable,false);assert.deepEqual(result.body.paymentMethods,[]);
 }finally{f.sql.close();}
});

test('forward correction revokes only the inherited side of a mixed confirmation',async t=>{
 for(const confirmed of releaseKeys)await t.test(confirmed,()=>{
  const f=fixture({released:false});
  try{
   set(f,'payment_alipay_released',1);
   for(const key of releaseKeys)f.sql.prepare('DELETE FROM system_settings WHERE key=?').run(key);
   f.sql.exec(splitSql);
   f.sql.prepare("UPDATE system_settings SET updated_by='test-user',updated_at=123 WHERE key=?").run(confirmed);
   const confirmedBefore=releaseRows(f).find(row=>row.key===confirmed);
   correct(f);
   const rows=releaseRows(f);
   assert.deepEqual(rows.find(row=>row.key===confirmed),confirmedBefore);
   assert.equal(rows.find(row=>row.key!==confirmed).value,'0');
  }finally{f.sql.close();}
 });
});

test('forward correction preserves independently saved admin confirmations and audit, including replay',async t=>{
 for(const [rsa2,epay] of [[false,false],[true,false],[false,true],[true,true]])await t.test(`RSA2=${rsa2}, Epay=${epay}`,async()=>{
  const f=fixture({released:false});epayCredentials(f);admin(f);
  try{
   const saved=await f.call('/v1/admin/payment-control',{body:{operationId:randomUUID(),reason:'Provider-specific platform confirmation',settings:settings(rsa2,epay)}});
   assert.equal(saved.status,200);
   const rows=releaseRows(f),audit=f.sql.prepare('SELECT * FROM admin_audit_logs').all(),before=businessSnapshot(f);
   assert.ok(rows.every(row=>row.updated_by==='test-user'));
   correct(f);correct(f);
   assert.deepEqual(releaseRows(f),rows);assert.deepEqual(f.sql.prepare('SELECT * FROM admin_audit_logs').all(),audit);
   assert.deepEqual(businessSnapshot(f),before);
   const methods=(await f.call('/v1/packages',{method:'GET'})).body.paymentMethods;
   assert.deepEqual(methods,rsa2?[{provider:'xiaodou',channel:'ALIPAY_H5'}]:epay?[{provider:'xiaodou_epay',channel:'ALIPAY_H5'}]:[]);
  }finally{f.sql.close();}
 });
});

test('legacy admin payload cannot grant new provider-specific Alipay release',async()=>{
 const f=fixture({released:false});admin(f);
 try{
  const saved=await f.call('/v1/admin/payment-control',{body:{operationId:randomUUID(),reason:'Legacy client changes interface controls',settings:legacySettings}});
  assert.equal(saved.status,200);
  assert.equal(saved.body.channels.rsa2.alipay.platformReleased,false);
  assert.equal(saved.body.channels.epay.alipay.platformReleased,false);
 }finally{f.sql.close();}
});

test('legacy admin payload preserves existing independent release decisions',async()=>{
 const f=fixture({released:false});admin(f);
 try{
  let saved=await f.call('/v1/admin/payment-control',{body:{operationId:randomUUID(),reason:'Confirm Epay separately from RSA2',settings:settings(false,true)}});
  assert.equal(saved.status,200);
  saved=await f.call('/v1/admin/payment-control',{body:{operationId:randomUUID(),reason:'Legacy client edits interface enablement',settings:legacySettings}});
  assert.equal(saved.status,200);
  assert.equal(saved.body.channels.rsa2.alipay.platformReleased,false);
  assert.equal(saved.body.channels.epay.alipay.platformReleased,true);
 }finally{f.sql.close();}
});
