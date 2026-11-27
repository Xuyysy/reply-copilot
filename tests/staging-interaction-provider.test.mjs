import test from 'node:test';
import assert from 'node:assert/strict';
import {createXInteractionProviderFactory} from '../staging/interaction-provider.js';
const binding={sourceTabId:1,ownerUserId:'111',handle:'me'};
function fixture({owner='111',fail=false}={}){
 const calls=[];
 const c={tabs:{sendMessage:async(id,m)=>{
  calls.push({id,...m});if(fail)throw Error('sensitive network body');
  if(m.action==='start'||m.action==='identity')return {ok:true,value:{ownerUserId:owner,handle:'me',sessionId:'opaque',providerId:'x-web-'+'a'.repeat(32),sources:['notification','post']}};
  if(m.action==='cancel')return {ok:true,value:{}};
  return {ok:true,value:{status:429}};
 }}};
 return {calls,factory:createXInteractionProviderFactory(c)};
}
test('trusted tab bridge exposes both sources and forwards only scoped read operations',async()=>{
 const f=fixture(),p=await f.factory(binding,{});
 assert.deepEqual(p.sources,['notification','post']);assert.equal(p.id,'x-web-'+'a'.repeat(32));assert.equal((await p.identify()).ownerUserId,'111');
 assert.equal((await p.readPage({ownerUserId:'111',source:'post',cursor:null})).status,429);
 await p.close();assert.ok(f.calls.every(c=>c.id===1));
 assert.deepEqual(f.calls.map(c=>c.action),['start','identity','page','cancel']);
 assert.ok(!JSON.stringify(f.calls).includes('cookie'));
 await assert.rejects(p.readPage({ownerUserId:'111',source:'post',cursor:null}),/cancelled/);
});

test('provider propagates bounded source diagnostics and drops arbitrary fields',async()=>{
 const api={tabs:{sendMessage:async(_id,message)=>{
  if(message.action==='start'||message.action==='identity')return {ok:true,value:{ownerUserId:'111',handle:'me',sessionId:'opaque',providerId:'x-web-'+'a'.repeat(32),sources:['notification','post']}};
  if(message.action==='cancel')return {ok:true,value:{}};
  return {ok:false,error:'schema_changed',sourceDiagnostic:{routeKind:'graphql',readPhase:'project',httpStatus:200,url:'fixture-sensitive-url',body:'fixture-sensitive-body'}};
 }}};
 const provider=await createXInteractionProviderFactory(api)(binding,{});
 await assert.rejects(provider.readPage({ownerUserId:'111',source:'notification',cursor:null}),e=>{
  assert.equal(e.message,'schema_changed');
  assert.deepEqual(e.sourceDiagnostic,{routeKind:'graphql',readPhase:'project',httpStatus:200});
  assert.ok(!JSON.stringify(e.sourceDiagnostic).includes('fixture-sensitive'));
  return true;
 });
 await provider.close();
});

test('foreign account and transport failure are bounded safe errors; invalid source/owner never requests a page',async()=>{
 const foreign=fixture({owner:'222'});await assert.rejects(foreign.factory(binding,{}),/identity_changed/);
 assert.equal(foreign.calls.at(-1).action,'cancel');
 await assert.rejects(fixture({fail:true}).factory(binding,{}),/^Error: source_unavailable$/);
 const f=fixture(),p=await f.factory(binding,{});
 for(const args of [{ownerUserId:'222',source:'post',cursor:null},{ownerUserId:'111',source:'following',cursor:null},{ownerUserId:'111',source:'post',cursor:''}])await assert.rejects(p.readPage(args),/invalid_context/);
 assert.equal(f.calls.length,1);await p.close();
});
test('abort cancels the exact connection, including before a delayed start reply',async()=>{
 const calls=[];let resolve;
 const f=createXInteractionProviderFactory({tabs:{sendMessage:async(id,m)=>{calls.push(m);return m.action==='start'?new Promise(r=>resolve=r):{ok:true,value:{}}}}});
 const c=new AbortController(),pending=f(binding,{signal:c.signal});c.abort();
 resolve({ok:true,value:{ownerUserId:'111',handle:'me',sessionId:'late',providerId:'x-web-'+'a'.repeat(32),sources:['notification','post']}});
 await assert.rejects(pending,/cancelled/);
 assert.ok(calls.slice(1).every(m=>m.action==='cancel'&&m.connectionId===calls[0].connectionId));
});
