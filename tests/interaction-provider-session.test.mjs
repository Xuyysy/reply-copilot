import test from 'node:test';
import assert from 'node:assert/strict';
import {openProviderSession} from '../interaction-manager/sync/provider-session.js';
const binding={ownerUserId:'111',handle:'me',sourceTabId:1};
const provider=extra=>({id:'authorized-reader-v1',sources:['notification','post'],identify:async()=>({ownerUserId:'111',sessionId:'opaque'}),readPage:async()=>({status:429}),...extra});
const tick=()=>new Promise(r=>setTimeout(r,5));
test('provider handshake is bounded and a late connection is closed exactly once',async()=>{
 let resolve,closed=0,signal;
 await assert.rejects(openProviderSession((b,o)=>{signal=o.signal;return new Promise(r=>resolve=r)},binding,{timeoutMs:10}),/time_limit/);
 assert.equal(signal.aborted,true);
 resolve(provider({close:async()=>closed++}));await tick();assert.equal(closed,1);
});
test('cancel during handshake releases it without waiting for transport; late provider cannot become usable',async()=>{
 const c=new AbortController();let resolve,closed=0;
 const pending=openProviderSession(()=>new Promise(r=>resolve=r),binding,{signal:c.signal});
 await tick();c.abort();await assert.rejects(pending,/cancelled/);
 resolve(provider({close:async()=>closed++}));await tick();assert.equal(closed,1);
});
test('dual-source contract preserves receiver, closes idempotently and fences later reads',async()=>{
 let closed=0;
 const raw=provider({identify(){assert.equal(this,raw);return Promise.resolve({ownerUserId:'111',sessionId:'opaque'})},close:async()=>closed++});
 const s=await openProviderSession(async()=>raw,binding);
 assert.deepEqual(s.sources,['notification','post']);
 assert.equal((await s.identify()).ownerUserId,'111');
 assert.equal((await s.readPage()).status,429);
 await Promise.all([s.close(),s.close()]);assert.equal(closed,1);
 await assert.rejects(s.identify(),/cancelled/);await assert.rejects(s.readPage(),/cancelled/);
});
test('invalid metadata or sources fail before any page read and clean up the connection',async()=>{
 for(const extra of [{id:'bad id'},{sources:[]},{sources:['notification','notification']},{sources:['following']},{identify:null},{readPage:null}]){
  let closed=0,read=0;
  await assert.rejects(openProviderSession(async()=>provider({readPage:async()=>read++,close:async()=>closed++,...extra}),binding),/source_unavailable/);
  assert.equal(read,0);assert.equal(closed,1);
 }
});
test('pre-aborted connection never calls factory and missing factory fails closed',async()=>{
 const c=new AbortController();c.abort();let calls=0;
 await assert.rejects(openProviderSession(()=>calls++,binding,{signal:c.signal}),/cancelled/);
 assert.equal(calls,0);await assert.rejects(openProviderSession(null,binding),/source_unavailable/);
});
test('cleanup failure or hung cleanup cannot retain a completed task slot',async()=>{
 for(const close of [async()=>{throw Error('fixture-sensitive-message')},()=>new Promise(()=>{})]){
  const s=await openProviderSession(async()=>provider({close}),binding,{closeTimeoutMs:10});
  await s.close();await assert.rejects(s.readPage(),/cancelled/);
 }
});

test('session lease preserves validated source identifiers separately from transport identity',async()=>{
 const s=await openProviderSession(async()=>provider({sourceIds:{notification:'notice-v1',post:'post-v1'}}),binding);
 assert.deepEqual(s.sourceIds,{notification:'notice-v1',post:'post-v1'});assert.ok(Object.isFrozen(s.sourceIds));await s.close();
 for(const sourceIds of [{notification:'notice-v1'},{notification:'same',post:'same'},{notification:'bad id',post:'post-v1'}])await assert.rejects(openProviderSession(async()=>provider({sourceIds}),binding),/source_unavailable/);
});
