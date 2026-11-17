import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildSync} from 'esbuild';
import {fixture,temp} from './helpers/payment-v2.mjs';

// No remote D1, production credentials, mailbox traffic or Cloudflare changes.
const modulePath=temp+'/password-fast-cost-first.cjs';
buildSync({entryPoints:[new URL('../src/password-auth.ts',import.meta.url).pathname],
  bundle:true,platform:'node',format:'cjs',target:'node22',outfile:modulePath});
const {hashPassword,verifyPassword}=createRequire(import.meta.url)(modulePath);
const pepper='local-only-pepper-must-not-be-real-credential';
const password='password-long-enough-2026!';
const env={PASSWORD_PEPPER:pepper,PASSWORD_FAST_CPU_ENABLED:'1'};
function oldHash(iterations){
 const salt='12'.repeat(16);
 const digest=pbkdf2Sync(password+'\0'+pepper,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
 return 'pbkdf2-sha256:'+iterations+':'+salt+':'+digest;
}
test('password-only fast mode generates 10k salted, peppered PBKDF2; rejects wrong password',async()=>{
 const a=await hashPassword(env,password),b=await hashPassword(env,password);
 assert.match(a,/^pbkdf2-sha256:10000:[0-9a-f]{32}:[0-9a-f]{64}$/);
 assert.notEqual(a.split(':')[2],b.split(':')[2],'each user gets random salt');
 assert.equal(await verifyPassword(env,password,a),true);
 assert.equal(await verifyPassword(env,'wrong-password-value',a),false);
 assert.equal(await verifyPassword({PASSWORD_PEPPER:pepper},password,a),true,'verifier survives flag rollback');
});
test('new 10k hash creation only under exact opt-in and overrides old 60k switch',async()=>{
 const off=await hashPassword({PASSWORD_PEPPER:pepper,PASSWORD_FAST_CPU_ENABLED:'true'},password);
 assert.match(off,/^pbkdf2-sha256:100000:/);
 const old=await hashPassword({PASSWORD_PEPPER:pepper,PASSWORD_FREE_CPU_ENABLED:'1'},password);
 assert.match(old,/^pbkdf2-sha256:60000:/);
 const both=await hashPassword({...env,PASSWORD_FREE_CPU_ENABLED:'1'},password);
 assert.match(both,/^pbkdf2-sha256:10000:/);
});
test('existing 60k/100k/210k passwords verify on Paid before exact Free legacy guard',async()=>{
 for(const iterations of [60_000,100_000,210_000]){
  const hash=oldHash(iterations);
  assert.equal(await verifyPassword(env,password,hash),true);
  assert.equal(await verifyPassword({...env,PASSWORD_LEGACY_COST_GUARD_ENABLED:'1'},password,hash),false);
 }
 const fast=await hashPassword(env,password);
 assert.equal(await verifyPassword({...env,PASSWORD_LEGACY_COST_GUARD_ENABLED:'1'},password,fast),true);
 assert.equal(await verifyPassword({PASSWORD_PEPPER:pepper,PASSWORD_LEGACY_COST_GUARD_ENABLED:'1'},password,oldHash(100_000)),true,
 'legacy guard cannot unexpectedly activate unless fast mode is explicitly enabled');
});
test('fast migration requires explicit opt-in and never migrates invalid/frozen users or credits',async()=>{
 for(const migrationFlag of ['0','1']){
  const f=fixture();
  try {
   f.env.PASSWORD_PEPPER=pepper;
   f.env.PASSWORD_FAST_CPU_ENABLED='1';
   f.env.PASSWORD_LEGACY_MIGRATION_ENABLED=migrationFlag;
   const original=oldHash(100_000);
   f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(original);
   const before=f.sql.prepare('SELECT COUNT(*) n FROM credit_ledger').get().n;
   let r=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:'incorrect-password'}});
   assert.equal(r.status,401);
   assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,original);
   f.sql.prepare("UPDATE users SET status='frozen' WHERE id='test-user'").run();
   r=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}});
   assert.equal(r.status,403);
   f.sql.prepare("UPDATE users SET status='active' WHERE id='test-user'").run();
   r=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}});
   assert.equal(r.status,200,JSON.stringify(r.body));
   const migrated=f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash;
   assert.equal(migrated.startsWith('pbkdf2-sha256:10000:'),migrationFlag==='1');
   if(migrationFlag!=='1')assert.equal(migrated,original);
   else {
    assert.equal(await verifyPassword(env,password,migrated),true);
    const second=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}});
    assert.equal(second.status,200);
    assert.equal(f.sql.prepare("SELECT password_hash FROM users WHERE id='test-user'").get().password_hash,migrated);
   }
   assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM credit_ledger').get().n,before);
  }finally{f.sql.close();}
 }
});
test('exact Free legacy guard refuses costly login, old password reset remains unchanged',async()=>{
 const f=fixture();
 try {
  f.env.PASSWORD_PEPPER=pepper;f.env.PASSWORD_FAST_CPU_ENABLED='1';
  f.env.PASSWORD_LEGACY_COST_GUARD_ENABLED='1';
  f.sql.prepare("UPDATE users SET password_hash=? WHERE id='test-user'").run(oldHash(210_000));
  const r=await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}});
  assert.equal(r.status,401);
  assert.equal(r.body.code,'INVALID_CREDENTIALS');
 }finally{f.sql.close();}
});
test('manual admin readiness distinguishes active 10k accounts without disclosing hashes',async()=>{
 const f=fixture();
 try{
  f.env.ADMIN_PORTAL_ENABLED='1';f.env.PASSWORD_FAST_CPU_ENABLED='1';
  f.sql.exec("UPDATE users SET role='admin',password_hash='pbkdf2-sha256:10000:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' WHERE id='test-user';");
  f.sql.exec("INSERT INTO site_administrator(id,user_id,bound_at) VALUES(1,'test-user',1)");
  const r=await f.call('/v1/admin/security/auth-cpu-readiness',{method:'GET'});
  assert.equal(r.status,200);
  assert.equal(r.body.mode.creationIterations,10000);
  assert.equal(r.body.hashes.optimized10k,1);
  assert.equal(r.body.hashes.legacy60k,0);
  assert.equal(r.body.passwordCpuMigrationComplete,true);
  assert.equal(r.body.freePlanCertified,false);
  assert.ok(!JSON.stringify(r.body).includes(pepper));
 }finally{f.sql.close();}
});
