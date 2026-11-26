import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const code=readFileSync(new URL('../staging/interaction-interface.js',import.meta.url),'utf8');
const origin='https://x.com',url=origin+'/i/api/2/notifications/all.json?count=20';
function fixture({responseStatus=200,changeAccount=false}={}){
 let listener,handle='me';const requests=[],doc={visibilityState:'visible',cookie:'twid=u%3D111; ct0=fixture-csrf',querySelectorAll:()=>[{href:origin+'/'+handle,getClientRects:()=>[{}],closest:()=>null}]};
 const sender={id:'test',url:'chrome-extension://test/sidepanel/sidepanel.html'};
 const body={globalObjects:{notifications:{},tweets:{},users:{}},timeline:{instructions:[{terminateTimeline:{direction:'Bottom'}}]}};
 vm.runInNewContext(code,{URL,URLSearchParams,AbortController,TextDecoder,Uint8Array,Set,Map,Promise,JSON,Date,Error,Object,Array,Number,String,RegExp,decodeURIComponent,setTimeout,clearTimeout,crypto:{randomUUID},location:{origin,pathname:'/notifications'},document:doc,performance:{getEntriesByType:()=>[{name:url}]},addEventListener:()=>{},chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>{listener=fn;}}}},fetch:async(u,opts)=>{requests.push({url:u,method:opts.method,credentials:opts.credentials,redirect:opts.redirect,csrf:opts.headers['x-csrf-token']});if(changeAccount){doc.cookie='twid=u%3D333; ct0=fixture-csrf';handle='other';}return new Response(JSON.stringify(body),{status:responseStatus});}});
 const send=(action,extra={},from=sender)=>new Promise(resolve=>{const returned=listener({type:'XRH_STAGING_INTERACTION_INTERFACE',action,...extra},from,resolve);if(returned!==true)resolve(null);});
 return {send,requests};
}
test('real transport contract: explicit authorization, extension sender, GET only and minimal result',async()=>{
 const f=fixture();
 assert.equal(await f.send('start',{authorized:true},{id:'other',url:'https://evil.invalid'}),null);
 assert.equal((await f.send('start',{authorized:false})).ok,false);
 const start=await f.send('start',{authorized:true});
 assert.equal(start.ok,true);assert.equal(start.value.ownerUserId,'111');
 const result=await f.send('page',{sessionId:start.value.sessionId,ownerUserId:'111',cursor:null});
 assert.equal(result.ok,true);assert.equal(result.value.status,200);assert.equal(result.value.done,true);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'GET');assert.equal(f.requests[0].credentials,'same-origin');assert.equal(f.requests[0].redirect,'error');assert.equal(f.requests[0].csrf,'fixture-csrf');assert.ok(!JSON.stringify(result).includes('fixture-csrf'));
});
test('429 stops further requests but retains verified local identity for ranking',async()=>{
 const f=fixture({responseStatus:429});const start=(await f.send('start',{authorized:true})).value;
 const args={sessionId:start.sessionId,ownerUserId:'111',cursor:null};
 assert.equal((await f.send('page',args)).value.status,429);
 assert.equal((await f.send('identity',args)).ok,true);
 assert.equal((await f.send('page',args)).error,'session_limit');
 assert.equal(f.requests.length,1);
});
test('account switch during request returns no data',async()=>{
 const f=fixture({changeAccount:true});const start=(await f.send('start',{authorized:true})).value;
 const r=await f.send('page',{sessionId:start.sessionId,ownerUserId:'111',cursor:null});
 assert.equal(r.ok,false);assert.equal(r.error,'identity_changed');assert.equal(r.value,undefined);
});
