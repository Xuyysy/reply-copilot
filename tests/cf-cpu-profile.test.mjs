import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {analyzeProfile,parseArgs,capture,markdownReport} from '../scripts/cf-cpu-profile.mjs';
const v=n=>{let x=BigInt(n),o=[];do{let b=Number(x&127n);x>>=7n;if(x)b|=128;o.push(b);}while(x);return o;};
const n=(tag,val)=>[...v(tag*8),...v(val)];
const m=(tag,bytes)=>[...v(tag*8+2),...v(bytes.length),...bytes];
const s=(tag,str)=>m(tag,new TextEncoder().encode(str));
function profile(app=0,gc=0,label=false){
 const strings=['','cpu','nanoseconds','doWork','(garbage collector)','PRIVATE_LABEL'];
 const types=m(1,[...n(1,1),...n(2,2)]);
 const fun=[m(5,[...n(1,1),...n(2,3)]),m(5,[...n(1,2),...n(2,4)])];
 const loc=[m(4,[...n(1,1),...m(4,n(1,1))]),m(4,[...n(1,2),...m(4,n(1,2))])];
 const samples=[];
 for(let i=0;i<app;i++)samples.push(m(2,[...n(1,1),...n(2,1000000),...(label?m(3,[...n(1,5),...n(2,5)]):[])]));
 for(let i=0;i<gc;i++)samples.push(m(2,[...n(1,2),...n(2,1000000)]));
 return Uint8Array.from([...types,...fun.flat(),...loc.flat(),...samples.flat(),...strings.flatMap(x=>s(6,x)),...n(9,1794900000000000000n)]);
}
test('GC-only profile is insufficient and never approves Free',()=>{
 const p=analyzeProfile(profile(0,8));assert.equal(p.status,'INSUFFICIENT_APP_SAMPLES');assert.equal(p.certifiedForFree,false);});
test('real CPU frames from gzip pprof are analyzed without labels',()=>{
 const p=analyzeProfile(gzipSync(profile(6,2,true)));assert.equal(p.status,'SAMPLED_APP_CPU');
 assert.equal(p.topSelf[0].name,'doWork');assert.equal(p.topSelf[0].percent,75);
 assert.doesNotMatch(JSON.stringify(p)+markdownReport(p),/PRIVATE_LABEL/);});
test('timestamp > safe number parses, malformed data fails',()=>{
 assert.equal(analyzeProfile(profile(6,0)).applicationCpuMs,6);
 assert.throws(()=>analyzeProfile(Uint8Array.from([255])),/Malformed|Unsupported|Invalid/);});
test('strict version/duration and no latest alias',()=>{
 assert.throws(()=>parseArgs(['--version','latest']),/Exact Worker/);
 assert.throws(()=>parseArgs(['--version','b10bdc5b-c9db-4d93-b0c8-b11e120376fb','--seconds','60']),/duration/);
 assert.equal(parseArgs(['--version','b10bdc5b-c9db-4d93-b0c8-b11e120376fb']).seconds,20);});
test('captures only profiling endpoint and does not trigger app traffic',async()=>{
 let call;const payload=profile(6);
 const fetchImpl=async(url,opts)=>{call={url,opts};return{ok:true,arrayBuffer:async()=>payload.buffer};};
 const b=await capture({accountId:'a'.repeat(32),token:'private',worker:'reply-copilot-api-production',
  version:'b10bdc5b-c9db-4d93-b0c8-b11e120376fb',seconds:20,fetchImpl});
 assert.equal(b.byteLength,payload.byteLength);assert.equal(call.opts.method,'POST');
 assert.match(call.url,/\/profile$/);
 assert.deepEqual(JSON.parse(call.opts.body),{duration_ms:20000,profile_type:'cpu'});});
test('API errors surface without retrying or modifying state',async()=>{
 await assert.rejects(capture({accountId:'a'.repeat(32),token:'private',worker:'worker',version:'uuid',seconds:10,
  fetchImpl:async()=>({ok:false,status:429})}),/HTTP 429/);});
