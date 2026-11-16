import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fixture} from './helpers/payment-v2.mjs';

const FIVE=['TRC20','POLYGON','BEP20','ERC20','SOLANA'];
function setup(){
 const f=fixture();
 f.env.ENVIRONMENT='production';
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.env.BOLTUTIL_ENABLED='1';
 f.env.BOLTUTIL_SCHEMA_READY='1';
 f.env.BOLTUTIL_PRODUCTION_CREATE_ENABLED='1';
 f.env.BOLTUTIL_API_KEY='fictional-api-secret';
 f.env.BOLTUTIL_WEBHOOK_SECRET='fictional-webhook-secret';
 f.env.BOLTUTIL_CNY_PER_USDT_MICROS='7234567';
 for(const network of FIVE)f.env['BOLTUTIL_'+network+'_ENABLED']='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator VALUES(1,'test-user',1)");
 return f;
}
const status=f=>f.call('/v1/admin/boltutil/control',{method:'GET'});
const publicStatus=f=>f.call('/v1/boltutil/availability',{method:'GET'});
const approve=f=>{
 f.env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED='1';
 f.env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED='1';
 f.env.BOLTUTIL_PRODUCTION_APPROVED_CNY_PER_USDT_MICROS=f.env.BOLTUTIL_CNY_PER_USDT_MICROS;
};
function operator(f,master=true,selected=FIVE){
 const sql=f.sql.prepare("INSERT INTO system_settings(key,value,updated_at) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET value=excluded.value");
 sql.run('boltutil_operator_enabled',master?'1':'0');
 for(const network of FIVE)sql.run('boltutil_operator_'+network.toLowerCase(),selected.includes(network)?'1':'0');
}
test('Production readiness reports every missing independent approval without leaking secrets or a rate',async()=>{
 const f=setup();try{
  const r=await status(f);
  assert.equal(r.status,200);
  assert.deepEqual(r.body.readiness.missing.sort(),[
    'schemaVerified','providerVerificationAcknowledged','approvedQuoteMatches','operatorMasterEnabled'
  ].sort());
  assert.equal(r.body.readiness.acceptingNewOrders,false);
  assert.deepEqual(r.body.readiness.networks.map(n=>n.acceptingNewOrders),Array(5).fill(false));
  const serialized=JSON.stringify(r.body);
  assert.ok(!serialized.includes('fictional-api-secret'));
  assert.ok(!serialized.includes('fictional-webhook-secret'));
  assert.ok(!serialized.includes('7234567'),'the exact merchant quote must never be returned');
  assert.deepEqual((await publicStatus(f)).body.networks,[]);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM system_settings WHERE key LIKE 'boltutil_operator_%'").get().n,0);
 }finally{f.sql.close();}
});
test('Readiness agrees with public availability and per-network permissions',async()=>{
 const f=setup();try{
  approve(f);operator(f,true,['TRC20','SOLANA']);
  const r=await status(f);
  assert.equal(r.status,200);
  assert.equal(r.body.readiness.acceptingNewOrders,true);
  assert.deepEqual(r.body.effectiveNetworks,['TRC20','SOLANA']);
  assert.deepEqual((await publicStatus(f)).body.networks,['TRC20','SOLANA']);
  assert.deepEqual(r.body.readiness.networks.filter(n=>n.acceptingNewOrders).map(n=>n.network),['TRC20','SOLANA']);
  assert.deepEqual(r.body.readiness.networks.find(n=>n.network==='POLYGON').blockedBy,['networkOperatorDisabled']);
  f.env.BOLTUTIL_ERC20_ENABLED='0';
  assert.deepEqual((await status(f)).body.readiness.networks.find(n=>n.network==='ERC20').blockedBy,
    ['networkEnvironmentDisabled','networkOperatorDisabled']);
 }finally{f.sql.close();}
});
test('Approval is bound to the exact quote and revoked on quote changes, absent provider attestation or schema attestation',async()=>{
 const f=setup();try{
  approve(f);operator(f);
  assert.equal((await status(f)).body.available,true);
  f.env.BOLTUTIL_CNY_PER_USDT_MICROS='7250000';
  assert.equal((await status(f)).body.available,false);
  assert.ok((await status(f)).body.readiness.missing.includes('approvedQuoteMatches'));
  assert.deepEqual((await publicStatus(f)).body.networks,[]);
  f.env.BOLTUTIL_CNY_PER_USDT_MICROS='7234567';
  f.env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED='0';
  assert.ok((await status(f)).body.readiness.missing.includes('providerVerificationAcknowledged'));
  f.env.BOLTUTIL_PRODUCTION_PROVIDER_VERIFIED='1';
  f.env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED='0';
  assert.ok((await status(f)).body.readiness.missing.includes('schemaVerified'));
  f.env.BOLTUTIL_PRODUCTION_SCHEMA_VERIFIED='1';
  assert.equal((await status(f)).body.available,true);
  operator(f,false);
  assert.equal((await status(f)).body.available,false);
  assert.ok((await status(f)).body.readiness.missing.includes('operatorMasterEnabled'));
 }finally{f.sql.close();}
});
test('Staging keeps its legacy flags and never needs Production approval',async()=>{
 const f=setup();try{
  f.env.ENVIRONMENT='staging';
  f.env.BOLTUTIL_STAGING_CREATE_ENABLED='1';
  operator(f,true);
  const r=await status(f);
  assert.equal(r.body.available,true);
  assert.deepEqual(r.body.readiness.missing,[]);
  assert.equal(r.body.readiness.checks.some(c=>c.id==='schemaVerified'),false);
  assert.equal(r.body.readiness.checks.some(c=>c.id==='approvedQuoteMatches'),false);
 }finally{f.sql.close();}
});
test('Nonadmin cannot inspect production readiness, even when Worker is ready',async()=>{
 const f=setup();try{
  f.sql.exec("UPDATE users SET role='user' WHERE id='test-user'");
  assert.equal((await status(f)).status,403);
 }finally{f.sql.close();}
});
