import test from 'node:test';
import assert from 'node:assert/strict';
import {createMomentumView} from '../../services/momentum-view.js';
import {execFileSync} from 'node:child_process';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';

function fixture(createView=createMomentumView, deliverBroadcast=()=>{}){
 let now=0,token='A',owner='owner',eligible=true,error=false,wait=null,calls=0,broadcasts=0,status='credits_available', globalEnabled=true;
 const saved=new Map();
 const view=createView({clock:()=>now,accountStates:{peekState:()=>({user:{userId:owner},status}),get cachedToken(){return token;}},client:{
  token:async()=>token,request:async(path,{expectedToken})=>{calls++;assert.match(path,/feature=interactionMomentum/);assert.equal(expectedToken,token);const id=owner;await wait;if(error)throw Error('offline');return {features:{interactionMomentum:{ownerId:id,eligible,policy:{...DEFAULT_MOMENTUM_CONFIG,enabled:globalEnabled}}}};}},
  momentum:{snapshot:async(id)=>({enabled:saved.get(id)}),drain:async()=>true,view:async(id,_policy,{enabled})=>{if(enabled!==undefined)saved.set(id,enabled);return {enabled:saved.get(id)};}},storage:{},broadcast:async()=>{broadcasts++;await deliverBroadcast();}});
 return {view,saved,global:enabled=>{globalEnabled=enabled;},get broadcasts(){return broadcasts;},get calls(){return calls;},freeze:()=>{status='frozen';},advance:ms=>{now+=ms;},paid:()=>{eligible=true;},expire:()=>{now+=300001;},free:()=>{eligible=false;},offline:()=>{error=true;},switch:()=>{token='B';owner='other';view.invalidate();},pause:()=>{let release;wait=new Promise(resolve=>{release=resolve;});return release;}};
}

test('expired proof refreshes before applying one click; passive views never fetch',async()=>{
 const f=fixture();
 assert.equal((await f.view({})).status,'unverified');assert.equal(f.calls,0);
 assert.equal((await f.view({refresh:true})).status,'paid');f.expire();
 assert.equal((await f.view({enabled:true})).enabled,true);
 assert.equal((await f.view({})).enabled,true);assert.equal(f.calls,2);
});
test('expired paid proof cannot enable for a now-free account; network error preserves preference',async()=>{
 const f=fixture();await f.view({enabled:true});f.expire();f.offline();
 assert.equal((await f.view({enabled:true})).status,'unverified');assert.equal(f.saved.get('owner'),true);
 const revoked=fixture();await revoked.view({refresh:true});revoked.expire();revoked.free();
 assert.equal((await revoked.view({enabled:true})).status,'free');assert.equal(revoked.saved.has('owner'),false);
});
test('concurrent refresh is shared and an in-flight old account cannot apply its intent',async()=>{
 const f=fixture(),release=f.pause();
 const one=f.view({enabled:true}),two=f.view({refresh:true});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(f.calls,1);
 f.switch();release();
 assert.equal((await one).status,'unverified');assert.equal((await two).status,'unverified');
 assert.equal(f.saved.size,0);assert.equal((await f.view({refresh:true})).enabled,false);
});

test('fresh paid proof is reused by every entry and successful changes broadcast once',async()=>{
 const f=fixture();await f.view({refresh:true});
 assert.equal((await f.view({enabled:true})).enabled,true);
 await Promise.all([f.view({}),f.view({claim:true}),f.view({})]);
 assert.equal(f.calls,1);
 assert.equal(f.broadcasts,3); // proof, preference, and completed count
});

test('negative cache expires sooner and explicit refresh is throttled while allowing a completed purchase to unlock',async()=>{
 const f=fixture();f.free();
 assert.equal((await f.view({ensure:true})).status,'free');
 await Promise.all([f.view({ensure:true}),f.view({refresh:true}),f.view({claim:true})]);
 assert.equal(f.calls,1);
 f.advance(5001);f.paid();
 assert.equal((await f.view({refresh:true})).status,'paid');
 assert.equal((await f.view({enabled:true})).enabled,true);
 assert.equal(f.calls,2);
 f.expire();f.offline();
 assert.equal((await f.view({ensure:true})).status,'unverified');
 await Promise.all([f.view({ensure:true}),f.view({refresh:true}),f.view({claim:true})]);
 assert.equal(f.calls,3);
 assert.equal(f.saved.get('owner'),true);
});

test('a free proof naturally expires after 120 seconds without a forced refresh', async()=>{
 const f=fixture();f.free();
 await f.view({ensure:true});f.advance(119999);f.paid();
 assert.equal((await f.view({ensure:true})).status,'free');
 f.advance(1);
 assert.equal((await f.view({ensure:true})).status,'paid');
 assert.equal(f.calls,2);
});

test('a known frozen account cannot use a cached paid proof', async()=>{
 const f=fixture();
 assert.equal((await f.view({ensure:true})).status,'paid');
 f.freeze();
 assert.equal((await f.view({enabled:true})).status,'unverified');
 assert.equal(f.saved.size,0);
 assert.equal(f.calls,1);
});

test('same-hour continuous ACKs reduce eligibility queries for enabled and disabled monitoring',async()=>{
 const baseline=execFileSync('git',['show','a2ed4f9:services/momentum-view.js'],{encoding:'utf8'})
  .replace('../domain/creator-momentum.js',new URL('../../domain/creator-momentum.js',import.meta.url).href);
 const old=(await import('data:text/javascript;base64,'+Buffer.from(baseline).toString('base64'))).createMomentumView;
 for(const [eligible,enabled,previous,current] of [[true,true,60,12],[true,false,60,0],[false,true,240,30],[false,false,240,0]]){
  const counts=[];
  for(const implementation of [old,createMomentumView]){
   const f=fixture(implementation);
   if(!eligible)f.free();
   if(enabled)f.saved.set('owner',true);
   for(let n=0;n<720;n++){await f.view({claim:true});f.advance(5000);}
   counts.push(f.calls);
  }
  assert.deepEqual(counts,[previous,current]);
  console.log({eligible,enabled,queriesBefore:counts[0],queriesAfter:counts[1]});
 }
});

test('global pause refuses a preference write and refresh restores the existing preference',async()=>{
 const f=fixture();f.saved.set('owner',true);f.global(false);
 assert.equal((await f.view({ensure:true})).policy.enabled,false);
 const paused=await f.view({enabled:false});
 assert.equal(paused.saved,false);assert.equal(paused.enabled,true);assert.equal(f.saved.get('owner'),true);
 f.global(true);f.advance(5001);
 assert.equal((await f.view({refresh:true})).enabled,true);
 assert.equal((await f.view({enabled:false})).saved,true);
});

test('a queued save from a previous account scope cannot change the new account',async()=>{
 const f=fixture();const old=await f.view({ensure:true});
 f.switch();await f.view({ensure:true});
 const stale=await f.view({enabled:true,scope:old.scope});
 assert.equal(stale.status,'unverified');assert.equal(f.saved.size,0);
});

test('a saved switch returns even if one of the UI broadcasts never acknowledges', {timeout:1000},async()=>{
 let hold=false;
 const f=fixture(createMomentumView,()=>hold ? new Promise(()=>{}) : undefined);
 await f.view({ensure:true});
 hold=true;
 for(let i=0;i<20;i++){
  const enabled=i%2===0;
  const result=await f.view({enabled});
  assert.equal(result.saved,true);
  assert.equal(f.saved.get('owner'),enabled);
 }
 assert.equal(f.calls,1);
});
