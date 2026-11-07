import test from 'node:test';
import assert from 'node:assert/strict';
import {createMomentumView} from '../../services/momentum-view.js';
import {DEFAULT_MOMENTUM_CONFIG} from '../../domain/creator-momentum.js';

function fixture(){
 let now=0,token='A',owner='owner',eligible=true,error=false,wait=null,calls=0;
 const saved=new Map();
 const view=createMomentumView({clock:()=>now,accountStates:{peekState:()=>({user:{userId:owner}}),get cachedToken(){return token;}},client:{
  token:async()=>token,request:async(path,{expectedToken})=>{calls++;assert.match(path,/feature=interactionMomentum/);assert.equal(expectedToken,token);const id=owner;await wait;if(error)throw Error('offline');return {features:{interactionMomentum:{ownerId:id,eligible,policy:DEFAULT_MOMENTUM_CONFIG}}};}},
  momentum:{drain:async()=>true,view:async(id,_policy,{enabled})=>{if(enabled!==undefined)saved.set(id,enabled);return {enabled:saved.get(id)};}},storage:{},broadcast:async()=>{}});
 return {view,saved,get calls(){return calls;},expire:()=>{now+=60001;},free:()=>{eligible=false;},offline:()=>{error=true;},switch:()=>{token='B';owner='other';view.invalidate();},pause:()=>{let release;wait=new Promise(resolve=>{release=resolve;});return release;}};
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
 const revoked=fixture();await revoked.view({refresh:true});revoked.free();
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
