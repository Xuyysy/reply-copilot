import test from 'node:test';
import assert from 'node:assert/strict';
import {pbkdf2Sync} from 'node:crypto';
import {Miniflare} from 'miniflare';
import {performance} from 'node:perf_hooks';

// Test the locked local runtime itself; no cloud, real credentials or database.
// The result can disprove an assumed native backend improvement, not certify Free.
const factors=[10000,60000,100000,210000];
const vectors=[{password:'synthetic-password-123',salt:'ab'.repeat(16)},{password:'synthetic-密码-🙂-123',salt:'cd'.repeat(16)}];
const source=`import {pbkdf2Sync,pbkdf2} from 'node:crypto';
const enc=new TextEncoder();
const hex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export default {async fetch(req){
 const {password,salt,factor,mode}=await req.json();
 if(![10000,60000,100000,210000].includes(factor)||!['webcrypto','node_sync','node_async'].includes(mode)||typeof password!=='string'||password.length>100||!/^[0-9a-f]{32}$/.test(salt))return new Response(null,{status:400});
 const bytes=Uint8Array.from(salt.match(/../g),x=>parseInt(x,16)),input=enc.encode(password+'\\0synthetic-pepper-only');
 try{
  let result;
  if(mode==='webcrypto'){
   const key=await crypto.subtle.importKey('raw',input,'PBKDF2',false,['deriveBits']);
   result=new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes,iterations:factor},key,256));
  }else if(mode==='node_sync')result=pbkdf2Sync(input,bytes,factor,32,'sha256');
  else result=await new Promise((resolve,reject)=>pbkdf2(input,bytes,factor,32,'sha256',(error,value)=>error?reject(error):resolve(value)));
  return Response.json({ok:true,digest:hex(result)});
 }catch(e){return Response.json({ok:false,error:['NotSupportedError','RangeError','Error','OperationError','TypeError'].includes(e?.name)?e.name:'UNKNOWN',iterationLimit:/iterations?|iteration count/i.test(String(e?.message??''))});}
}};`;
test('CF Free actual workerd native PBKDF2 compatibility matrix',{timeout:120000},async()=>{
 let outbound=0;
 const mf=new Miniflare({workers:[{config:{name:'isolated-kdf-native-matrix',compatibilityDate:'2026-10-14',compatibilityFlags:['nodejs_compat'],
   manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:source}}}},dev:{outboundService:{type:'fetcher',handler:()=>{outbound++;throw Error('No network');}}}}]});
 try{
  const evidence=[];
  for(const factor of factors)for(const mode of ['webcrypto','node_sync','node_async']){
   const wall=[];let matched=0,blocked=0;const errorClasses=new Set();
   for(const vector of vectors){
    const start=performance.now();
    const response=await mf.dispatchFetch('https://isolated.test/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...vector,factor,mode})});
    assert.equal(response.status,200);
    const r=await response.json();wall.push(performance.now()-start);
    if(r.ok){
     const expected=pbkdf2Sync(vector.password+'\0synthetic-pepper-only',Buffer.from(vector.salt,'hex'),factor,32,'sha256').toString('hex');
     assert.equal(r.digest,expected,'native result must exactly match Node reference');
     matched++;
    }else{
     assert.equal(factor,210000,'normal work factors must work');
     assert.equal(r.iterationLimit,true,'210k error must be an identified iteration restriction');
     blocked++;errorClasses.add(r.error);
    }
   }
   assert.ok(matched===vectors.length||blocked===vectors.length,'consistent runtime compatibility');
   evidence.push({factor,mode,matched,blocked,errorClasses:[...errorClasses],dispatchWallMs:wall.map(v=>Number(v.toFixed(3)))});
  }
  assert.equal(outbound,0);
  console.log('CF_FREE_NATIVE_KDF_MATRIX '+JSON.stringify({scope:'LOCAL_WORKERD_ONLY',freeCertified:false,evidence}));
 }finally{await mf.dispose();}
});
