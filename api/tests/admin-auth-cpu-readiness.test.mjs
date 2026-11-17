import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/payment-v2.mjs';
import {AUTH_CPU_READINESS_SQL} from '../src/admin-auth-cpu-readiness.ts';

function grantAdmin(f){
 f.env.ADMIN_PORTAL_ENABLED='1';
 f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
}
function artificialHash(iterations){
 return 'pbkdf2-sha256:'+iterations+':'+'ab'.repeat(16)+':'+'cd'.repeat(32);
}
test('CPU migration readiness is explicit, admin-only, aggregated, and never returns password material',async()=>{
 const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';
  assert.equal((await f.call('/v1/admin/security/auth-cpu-readiness',{method:'GET'})).status,403);
  grantAdmin(f);
  f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(artificialHash(100000));
  const insert=f.sql.prepare("INSERT INTO users(id,email,email_verified_at,created_at,password_hash,status) VALUES(?,?,1,1,?,?)");
  insert.run('synthetic-60','cpu60@example.test',artificialHash(60000),'active');
  insert.run('synthetic-210','cpu210@example.test',artificialHash(210000),'active');
  insert.run('synthetic-old-frozen','frozen@example.test',artificialHash(210000),'frozen');
  insert.run('synthetic-broken','broken@example.test','unsupported-test-only-hash','active');
  let seen=0;
  const original=f.DB.prepare.bind(f.DB);
  f.DB.prepare=sql=>{if(sql===AUTH_CPU_READINESS_SQL)seen++;return original(sql);};
  const res=await f.call('/v1/admin/security/auth-cpu-readiness',{method:'GET'});
  assert.equal(res.status,200,JSON.stringify(res.body));
  assert.equal(seen,1,'readiness query is deliberately called only when endpoint is requested');
  assert.deepEqual(res.body.hashes,{passwordAccounts:5,active:4,optimized60k:1,legacy100k:1,legacy210k:1,unsupported:1,nonActiveLegacy:1});
  assert.equal(res.body.passwordCpuMigrationComplete,false);
  assert.equal(res.body.freePlanCertified,false);
  assert.deepEqual(res.body.mode,{creationIterations:100000,migrationEnabled:false});
  assert.ok(!JSON.stringify(res.body).includes('cpu60@example.test'));
  assert.ok(!JSON.stringify(res.body).includes('synthetic-test-only-hash'));
  assert.ok(!JSON.stringify(res.body).includes('password_hash'));
  assert.ok(!JSON.stringify(res.body).includes('ab'.repeat(16)));
  assert.equal(res.body.hashes.active,res.body.hashes.optimized60k+res.body.hashes.legacy100k+res.body.hashes.legacy210k+res.body.hashes.unsupported);
 }finally{f.sql.close();}
});

test('readiness flags do not enable migration unless both switches are exactly 1',async()=>{
 const f=fixture();
 try{
  grantAdmin(f);
  f.env.PASSWORD_LEGACY_MIGRATION_ENABLED='1';
  let r=await f.call('/v1/admin/security/auth-cpu-readiness',{method:'GET'});
  assert.equal(r.body.mode.migrationEnabled,false);
  f.env.PASSWORD_FREE_CPU_ENABLED='1';
  r=await f.call('/v1/admin/security/auth-cpu-readiness',{method:'GET'});
  assert.equal(r.body.mode.migrationEnabled,true);
  assert.equal(r.body.mode.creationIterations,60000);
  assert.equal(r.body.freePlanCertified,false);
 }finally{f.sql.close();}
});
