import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProviderEndpoint} from '../src/ai-model-provider.js';
const config={provider:'openai_compatible',protocol:'openai_chat',baseUrl:'https://model.example.com/v1'};
test('both DNS families start before either resolves, but no credential-bearing fetch is made',async()=>{
 const original=globalThis.fetch,calls=[],pending=[];
 globalThis.fetch=(url,options)=>{calls.push(new URL(url).searchParams.get('type'));assert.equal(options.redirect,'manual');assert.equal(options.headers.authorization,undefined);return new Promise(resolve=>pending.push(resolve));};
 try{
  const check=validateProviderEndpoint(config);await new Promise(r=>setImmediate(r));
  assert.deepEqual(calls,['A','AAAA']);
  pending[0](Response.json({Status:0,Answer:[{type:1,data:'93.184.216.34'}]}));
  pending[1](Response.json({Status:0,Answer:[{type:28,data:'2606:4700:4700::1111'}]}));
  assert.deepEqual(await check,['2606:4700:4700::1111','93.184.216.34']);
 }finally{globalThis.fetch=original;for(const resolve of pending)resolve(Response.json({Status:0}));}
});

for(const [name,answer,code] of [
 ['mixed public A / private AAAA',type=>type==='A'?{Status:0,Answer:[{type:1,data:'93.184.216.34'}]}:{Status:0,Answer:[{type:28,data:'::1'}]},'unsafe_endpoint'],
 ['changed custom pinned address',()=>({Status:0,Answer:[{type:1,data:'93.184.216.35'}]}),'dns_changed'],
])test(name+' remains fail-closed',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async url=>Response.json(answer(new URL(url).searchParams.get('type')));
 try{await assert.rejects(validateProviderEndpoint({...config,endpointAddresses:['93.184.216.34']}),e=>e.code===code);}finally{globalThis.fetch=original;}
});

test('CNAME chains and malformed/redirect DNS responses retain existing safety checks',async()=>{
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async url=>{calls++;const name=new URL(url).searchParams.get('name');return Response.json({Status:0,Answer:name==='model.example.com'?[{type:5,data:'edge.example.com.'}]:[{type:1,data:'93.184.216.34'}]});};
 try{
  assert.deepEqual(await validateProviderEndpoint(config),['93.184.216.34']);assert.equal(calls,4);
  globalThis.fetch=async()=>new Response('',{status:302,headers:{location:'https://evil.example'}});
  await assert.rejects(validateProviderEndpoint(config),e=>e.code==='dns_unavailable');
  globalThis.fetch=async()=>new Response('{broken',{status:200});
  await assert.rejects(validateProviderEndpoint(config),e=>e.code==='dns_unavailable');
  globalThis.fetch=async()=>Response.json({Status:0,Answer:[{type:5,data:'model.example.com.'}]});
  await assert.rejects(validateProviderEndpoint(config),e=>e.code==='dns_invalid');
 }finally{globalThis.fetch=original;}
});

test('DNS timeout aborts both family lookups without a credential-bearing request',async t=>{
 const original=globalThis.fetch;let aborted=0;
 t.mock.timers.enable({apis:['setTimeout']});
 globalThis.fetch=async(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(new Error('aborted'));}));
 try{const task=validateProviderEndpoint(config);t.mock.timers.tick(8000);await assert.rejects(task,e=>e.code==='dns_timeout');assert.equal(aborted,2);}finally{globalThis.fetch=original;t.mock.timers.reset();}
});
