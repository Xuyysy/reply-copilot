import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {pbkdf2Sync} from 'node:crypto';
import {createRequire} from 'node:module';
import {fixture,temp} from './helpers/payment-v2.mjs';
const f=temp+'/password-cf-free-tiny-profile.cjs';
buildSync({entryPoints:[new URL('../src/password-auth.ts',import.meta.url).pathname],bundle:true,
  platform:'node',format:'cjs',target:'node22',outfile:f});
const {hashPassword,verifyPassword}=createRequire(import.meta.url)(f);
const pepper='synthetic-password-pepper-long-enough-for-test';
const pwd='a-test-strong-password-26!';
const eligible={PASSWORD_PEPPER:pepper,PASSWORD_FREE_CPU_ENABLED:'1',PASSWORD_FREE_TINY_CPU_ENABLED:'1'};
const hexSalt='00'.repeat(16);
function legacy(rounds){
 const hash=pbkdf2Sync(pwd+'\0'+pepper,Buffer.from(hexSalt,'hex'),rounds,32,'sha256').toString('hex');
 return 'pbkdf2-sha256:'+rounds+':'+hexSalt+':'+hash;
}
test('tiny profile is triple-gated; default 100k and existing two-switch 60k unchanged',async()=>{
 const normal=await hashPassword({PASSWORD_PEPPER:pepper},pwd);
 assert.match(normal,/^pbkdf2-sha256:100000:/);
 const tinyWithoutFree=await hashPassword({PASSWORD_PEPPER:pepper,PASSWORD_FREE_TINY_CPU_ENABLED:'1'},pwd);
 assert.match(tinyWithoutFree,/^pbkdf2-sha256:100000:/);
 const freeOnly=await hashPassword({PASSWORD_PEPPER:pepper,PASSWORD_FREE_CPU_ENABLED:'1'},pwd);
 assert.match(freeOnly,/^pbkdf2-sha256:60000:/);
 const invalidOptIn=await hashPassword({...eligible,PASSWORD_FREE_TINY_CPU_ENABLED:'true'},pwd);
 assert.match(invalidOptIn,/^pbkdf2-sha256:60000:/);
 const ten=await hashPassword(eligible,pwd);
 assert.match(ten,/^pbkdf2-sha256:10000:[0-9a-f]{32}:[0-9a-f]{64}$/);
 assert.notEqual(ten,(await hashPassword(eligible,pwd)),'unique random salt');
 assert.equal(await verifyPassword(eligible,pwd,ten),true);
 assert.equal(await verifyPassword(eligible,'wrong',ten),false);
 assert.equal(await verifyPassword({PASSWORD_PEPPER:pepper},pwd,ten),true,'gate OFF still verifies low cost hashes');
});
test('legacy password compatibility; unsupported iterations fail closed, no plaintext',async()=>{
 for(const rounds of [10000,60000,100000,210000]){
   assert.equal(await verifyPassword(eligible,pwd,legacy(rounds)),true,String(rounds));
   assert.equal(await verifyPassword(eligible,'wrong',legacy(rounds)),false);
 }
 for(const rounds of [0,1000,5000,9999,20000,500000]){
   assert.equal(await verifyPassword(eligible,pwd,legacy(10000).replace(':10000:',':'+rounds+':')),false);
 }
 assert.equal(await verifyPassword({...eligible,PASSWORD_PEPPER:'short'},pwd,legacy(10000)).then(()=>false).catch(()=>true),true);
});
test('Paid-stage migration requires both old flags, plus third tiny flag to choose 10k',async()=>{
 const f=fixture();
 try{
  f.env.PASSWORD_PEPPER=pepper;f.env.PASSWORD_FREE_CPU_ENABLED='1';
  f.env.PASSWORD_FREE_TINY_CPU_ENABLED='1';f.env.PASSWORD_LEGACY_MIGRATION_ENABLED='1';
  f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(legacy(100000));
  const before=f.sql.prepare('SELECT count(*) n FROM credit_ledger').get().n;
  const login=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:pwd}});
  assert.equal(login.status,200,JSON.stringify(login.body));
  const hash=f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash;
  assert.match(hash,/^pbkdf2-sha256:10000:/);
  assert.equal(await verifyPassword(eligible,pwd,hash),true);
  assert.equal(before,f.sql.prepare('SELECT count(*) n FROM credit_ledger').get().n);
  const again=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:pwd}});
  assert.equal(again.status,200);
  assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,hash,'no rehash loop');
 }finally{f.sql.close();}
});
test('wrong password, frozen user, missing migration gate cannot downgrade stored hash',async()=>{
 const f=fixture();
 try{
  f.env.PASSWORD_PEPPER=pepper;
  Object.assign(f.env,{PASSWORD_FREE_CPU_ENABLED:'1',PASSWORD_FREE_TINY_CPU_ENABLED:'1',
    PASSWORD_LEGACY_MIGRATION_ENABLED:'0'});
  const old=legacy(210000);
  f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(old);
  let bad=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:'wrong password'}});
  assert.equal(bad.status,401);
  assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,old);
  let login=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:pwd}});
  assert.equal(login.status,200);
  assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,old);
  f.env.PASSWORD_LEGACY_MIGRATION_ENABLED='1';
  f.sql.exec("UPDATE users SET status='frozen' WHERE id='test-user'");
  login=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:pwd}});
  assert.equal(login.status,403);
  assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,old);
 }finally{f.sql.close();}
});
test('readiness gate distinguishes all hashes with tiny mode off and on',async()=>{
 const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';
  f.sql.exec("UPDATE users SET role='admin' WHERE id='test-user'; INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
  f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(legacy(100000));
  const insert=f.sql.prepare("INSERT INTO users(id,email,email_verified_at,created_at,password_hash,status) VALUES(?,?,1,1,?,?)");
  insert.run('ten','ten@example.test',legacy(10000),'active');
  insert.run('sixty','sixty@example.test',legacy(60000),'active');
  insert.run('frozen','frozen@example.test',legacy(60000),'frozen');
  const request={method:'GET'};
  let r=await f.call('/v1/admin/security/auth-cpu-readiness',request);
  assert.equal(r.status,200);
  assert.equal(r.body.tinyCpuReadiness.activeTenKHashes,1);
  assert.equal(r.body.tinyCpuReadiness.activeNotTenKHashes,2);
  assert.equal(r.body.tinyCpuReadiness.inactiveNotTenKHashes,1);
  assert.equal(r.body.tinyCpuReadiness.allPasswordHashesTenK,false);
  assert.equal(r.body.tinyCpuReadiness.enabled,false);
  f.env.PASSWORD_FREE_CPU_ENABLED='1';f.env.PASSWORD_FREE_TINY_CPU_ENABLED='1';
  r=await f.call('/v1/admin/security/auth-cpu-readiness',request);
  assert.equal(r.body.mode.creationIterations,10000);
  assert.equal(r.body.passwordCpuMigrationComplete,false);
  assert.equal(r.body.freePlanCertified,false);
  assert.equal(r.body.tinyCpuReadiness.enabled,true);
  assert.doesNotMatch(JSON.stringify(r.body),/ten@example.test|password_hash|[a-f0-9]{32}:[a-f0-9]{64}/);
 }finally{f.sql.close();}
});
