import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {temp} from './helpers/payment-v2.mjs';

// Synthetic only. The test patches global Node WebCrypto inside this test process
// to count imports; no network, Cloudflare account, D1 SQL, or real secrets.
const outfile=temp+'/cf-free-hmac-cache.cjs';
buildSync({entryPoints:[new URL('../src/security.ts',import.meta.url).pathname],bundle:true,format:'cjs',platform:'node',target:'node22',outfile});
const {hmac}=createRequire(import.meta.url)(outfile);
const a='synthetic-test-auth-secret-00000000000000000000';
const b='synthetic-test-auth-secret-11111111111111111111';
const text='login-ip:synthetic-value';

test('cached auth HMAC matches original bytes, reuses key and isolates/rotates secrets',async()=>{
 const subtle=crypto.subtle, original=subtle.importKey, own=Object.getOwnPropertyDescriptor(subtle,'importKey');
 let imports=0;
 Object.defineProperty(subtle,'importKey',{configurable:true,writable:true,value:function(...args){imports++;return original.apply(this,args);}});
 try{
  const env={AUTH_HASH_SECRET:a},other={AUTH_HASH_SECRET:a};
  const expected=createHmac('sha256',a).update(text).digest('hex');
  assert.equal(await hmac(env,text),expected);
  assert.equal(await hmac(env,text),expected);
  assert.equal(imports,1,'same Env must reuse a single CryptoKey import');
  assert.equal(await hmac(other,text),expected);
  assert.equal(imports,2,'another environment binding must never borrow the first key');
  env.AUTH_HASH_SECRET=b;
  assert.equal(await hmac(env,text),createHmac('sha256',b).update(text).digest('hex'));
  assert.equal(imports,3,'secret rotation must invalidate the cached key');
  env.AUTH_HASH_SECRET='short';
  await assert.rejects(hmac(env,text),x=>x.code==='SERVER_UNAVAILABLE');
  assert.equal(imports,3,'bad configuration must fail before any key import');
 }finally{
  if(own)Object.defineProperty(subtle,'importKey',own);
  else Reflect.deleteProperty(subtle,'importKey');
 }
});

test('HMAC import failures are not cached and next valid request retries',async()=>{
 const subtle=crypto.subtle,original=subtle.importKey,own=Object.getOwnPropertyDescriptor(subtle,'importKey');
 let fail=true,imports=0;
 Object.defineProperty(subtle,'importKey',{configurable:true,writable:true,value:function(...args){imports++;if(fail){fail=false;return Promise.reject(Error('synthetic import failure'));}return original.apply(this,args);}});
 try{
  const env={AUTH_HASH_SECRET:a};
  await assert.rejects(hmac(env,'retry'),/synthetic import failure/);
  assert.equal(await hmac(env,'retry'),createHmac('sha256',a).update('retry').digest('hex'));
  assert.equal(imports,2);
 }finally{
  if(own)Object.defineProperty(subtle,'importKey',own);
  else Reflect.deleteProperty(subtle,'importKey');
 }
});
