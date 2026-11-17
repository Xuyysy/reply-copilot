import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fixture,temp} from './helpers/payment-v2.mjs';

// Offline synthetic CPU compatibility test; no remote D1, network, or credentials.
const modulePath=temp+'/password-cf-free.cjs';
buildSync({entryPoints:[new URL('../src/password-auth.ts',import.meta.url).pathname],bundle:true,platform:'node',format:'cjs',target:'node22',outfile:modulePath});
const {hashPassword,verifyPassword}=createRequire(import.meta.url)(modulePath);
const env={PASSWORD_PEPPER:'synthetic-local-pepper-which-is-not-a-production-secret',PASSWORD_FREE_CPU_ENABLED:'1'};
const password='test-only-long-password-2026!';
const salt='00'.repeat(16);
function legacyHash(iterations){
 const digest=pbkdf2Sync(password+'\0'+env.PASSWORD_PEPPER,Buffer.from(salt,'hex'),iterations,32,'sha256').toString('hex');
 return `pbkdf2-sha256:${iterations}:${salt}:${digest}`;
}

test('Free CPU candidate creates 60k hashes with salt, pepper and full verification',async()=>{
 const start=performance.now(),hash=await hashPassword(env,password);
 const derivationMs=performance.now()-start;
 assert.match(hash,/^pbkdf2-sha256:60000:[0-9a-f]{32}:[0-9a-f]{64}$/);
 assert.equal(await verifyPassword(env,password,hash),true);
 assert.equal(await verifyPassword(env,'wrong-test-password',hash),false);
 assert.notEqual((await hashPassword(env,password)).split(':')[2],hash.split(':')[2],'independent salts');
 console.log(JSON.stringify({event:'local_cf_free_password_hash',iterations:60000,wallMs:Number(derivationMs.toFixed(2)),scope:'local Node only, not edge CPU limit proof'}));
});

test('safe default stays at 100k before an explicitly enabled compatible rollout',async()=>{
 const defaults={PASSWORD_PEPPER:env.PASSWORD_PEPPER};
 const before=await hashPassword(defaults,password);
 assert.match(before,/^pbkdf2-sha256:100000:[0-9a-f]{32}:[0-9a-f]{64}$/);
 assert.equal(await verifyPassword(defaults,password,before),true);
 const invalidFlag=await hashPassword({...defaults,PASSWORD_FREE_CPU_ENABLED:'true'},password);
 assert.match(invalidFlag,/^pbkdf2-sha256:100000:/,'only exact explicit 1 enables the lower work factor');
 // Production with the switch OFF must still verify opt-in hashes issued earlier.
 const fast=await hashPassword(env,password);
 assert.equal(await verifyPassword(defaults,password,fast),true);
});

test('Free candidate preserves legacy 100k and 210k verifiers, rejects invalid work factors',async()=>{
 for(const iterations of [100_000,210_000]){
  const hash=legacyHash(iterations);
  assert.equal(await verifyPassword(env,password,hash),true,`legacy ${iterations}`);
  assert.equal(await verifyPassword(env,'wrong-test-password',hash),false,`invalid legacy ${iterations}`);
 }
 assert.equal(await verifyPassword(env,password,legacyHash(100_000).replace(':100000:',':1000:')),false);
 assert.equal(await verifyPassword({...env,PASSWORD_PEPPER:''},password,legacyHash(100_000)).then(()=>false).catch(()=>true),true,'missing pepper must fail closed');
});

test('actual password login accepts new Free-cost hash without disabling existing lockouts or sessions',async()=>{
 const f=fixture();
 try {
  f.env.PASSWORD_PEPPER=env.PASSWORD_PEPPER;
  const hash=await hashPassword(env,password);
  f.sql.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,'test-user');
  assert.equal((await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}})).status,200);
  assert.equal((await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password:'not-the-password'}})).status,401);
  f.sql.prepare("UPDATE users SET status='frozen' WHERE id='test-user'").run();
  assert.equal((await f.call('/v1/auth/login',{body:{identity:'v2@example.test',password}})).status,403);
 } finally {f.sql.close();}
});
