// Runs only in a disposable offline workerd laboratory, never in production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash,pbkdf2Sync} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {Miniflare} from 'miniflare';
import {buildSync} from 'esbuild';
const artifact=new URL('../prototypes/cf-free-rustcrypto-wasm/target/wasm32-unknown-unknown/release/xrh_legacy_kdf_lab.wasm',import.meta.url);
const wasm=new Uint8Array(readFileSync(artifact));
assert.ok(wasm.length>0&&wasm.length<1024*1024);
const source=String.raw`
import compiled from './legacy.wasm';
import {pbkdf2} from '@noble/hashes/pbkdf2';
import {sha256} from '@noble/hashes/sha2';
const instance=new WebAssembly.Instance(compiled);
const {memory,buffer_ptr,derive_210k}=instance.exports;
const enc=new TextEncoder();
const toHex=bytes=>Array.from(bytes,x=>x.toString(16).padStart(2,'0')).join('');
export default {async fetch(req){
 const {password,salt,mode}=await req.json();
 if(typeof password!=='string'||password.length>256||!/^[a-f0-9]{32}$/.test(salt)||!['wasm','noble'].includes(mode))return new Response(null,{status:400});
 const material=enc.encode(password+'\0synthetic-pepper-only');
 const saltBytes=Uint8Array.from(salt.match(/../g),x=>parseInt(x,16));
 if(material.length>1024)return new Response(null,{status:400});
 let output;
 try{
  if(mode==='wasm'){
   const p=buffer_ptr(),view=new Uint8Array(memory.buffer,p,1072);
   view.fill(0);view.set(material);view.set(saltBytes,1024);
   try{if(derive_210k(material.length)!==1)throw Error('WASM_FAILED');output=new Uint8Array(memory.buffer,p+1040,32).slice();}
   finally{new Uint8Array(memory.buffer,p,1072).fill(0);}
  }else output=pbkdf2(sha256,material,saltBytes,{c:210000,dkLen:32});
  return Response.json({digest:toHex(output)});
 }finally{material.fill(0);saltBytes.fill(0);output?.fill(0);}
}};
`;
const bundle=buildSync({stdin:{contents:source,resolveDir:new URL('../',import.meta.url).pathname,sourcefile:'lab.mjs'},bundle:true,platform:'browser',format:'esm',write:false,external:['./legacy.wasm']}).outputFiles[0].text;
let external=0;
const mf=new Miniflare({workers:[{config:{name:'xrh-isolated-rustcrypto-kdf',compatibilityDate:'2026-10-14',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:bundle},'legacy.wasm':{type:'wasm',contents:wasm}}}},dev:{outboundService:{type:'fetcher',handler:()=>{external++;throw Error('OFFLINE_ONLY');}}}}]});
try{
 const vectors=[{password:'synthetic-password-123!',salt:'ab'.repeat(16)},{password:'synthetic-密码-🙂-123!',salt:'cd'.repeat(16)},{password:'x'.repeat(256),salt:'ef'.repeat(16)}];
 const results=[];
 for(const vector of vectors){
  const expected=pbkdf2Sync(vector.password+'\0synthetic-pepper-only',Buffer.from(vector.salt,'hex'),210000,32,'sha256').toString('hex');
  const samples={wasm:[],noble:[]};
  for(let i=0;i<3;i++)for(const mode of (i%2?['noble','wasm']:['wasm','noble'])){
   const start=performance.now();
   const response=await mf.dispatchFetch('https://isolated.test/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...vector,mode})});
   const body=await response.json();const ms=performance.now()-start;
   assert.equal(response.status,200);assert.equal(body.digest,expected);
   samples[mode].push(Number(ms.toFixed(3)));
  }
  results.push(samples);
 }
 assert.equal(external,0);
 const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
 const wasmMedian=median(results.flatMap(x=>x.wasm)),nobleMedian=median(results.flatMap(x=>x.noble));
 console.log('CF_FREE_RUSTCRYPTO_WASM_LAB '+JSON.stringify({scope:'LOCAL_WORKERD_ONLY',freeCertified:false,workFactor:210000,vectors:3,matched:18,externalCalls:external,wasmBytes:wasm.length,wasmSha256:createHash('sha256').update(wasm).digest('hex'),dispatchWallMs:{wasmMedian,nobleMedian,ratio:nobleMedian/wasmMedian,results}}));
}finally{await mf.dispose();}
