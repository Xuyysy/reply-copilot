import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {memoryStorage} from './helpers.js';
execFileSync(process.execPath,['scripts/build.js','staging'],{env:{...process.env,REPLY_COPILOT_STAGING_NO_DEBUGGER:'1',REPLY_COPILOT_STAGING_INPUT_VALIDATION:'1',REPLY_COPILOT_API_URL:'https://api-staging.x-reply-helper.top',REPLY_COPILOT_WEBSITE_URL:'https://staging.x-reply-helper.top'}});
const nativeTimeout=globalThis.setTimeout;globalThis.setTimeout=(fn,ms,...args)=>{const t=nativeTimeout(fn,ms,...args);if(ms===120000)t.unref();return t;};
const event=()=>({addListener(listener){this.listener=listener}}),local=memoryStorage(),session=memoryStorage();local.data.replyCopilotAccountToken='local-test-token';
globalThis.chrome={runtime:{id:'staging-test',onInstalled:event(),onMessage:event()},storage:{local,session,onChanged:event()},contextMenus:{onClicked:event()},sidePanel:{}};
const raw=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'en',reason:'Relevant.',quoteCandidate:null,replies:{natural:'One.',light_humor:'Two.',thoughtful:'Three.'}});
let finish,started;const entered=new Promise(r=>started=r);const generated=[],acked=new Set();let firstSignal;
globalThis.fetch=async(url,options)=>{
 const path=new URL(url).pathname;let data;
 if(path==='/v1/me')data={user:{userId:'test-account',username:'tester'}};
 else if(path==='/v1/entitlements')data={status:'credits_available'};
 else if(path==='/v1/usage')data={quota:{freeRemaining:200-acked.size,paidRemaining:0,totalRemaining:200-acked.size}};
 else if(path==='/v1/ai/generate'){
  const id=JSON.parse(options.body).requestId;generated.push(id);
  if(generated.length===1){firstSignal=options.signal;started();await new Promise(r=>finish=r);}
  data={raw};
 }else if(path.endsWith('/delivered')){acked.add(JSON.parse(options.body).requestId);data={ok:true,quota:{freeRemaining:200-acked.size,paidRemaining:0,totalRemaining:200-acked.size}};}
 else data={};
 return {ok:true,json:async()=>data};
};
await import('../dist/staging/background/service-worker.js');
const sender={id:'staging-test',url:'https://x.com/home',tab:{id:42},frameId:0};
const send=message=>new Promise(resolve=>chrome.runtime.onMessage.listener(message,sender,resolve));
test('packaged Staging worker detaches a closed composer, settles its delivery and serializes the next reply',async()=>{
 const firstId=crypto.randomUUID(),secondId=crypto.randomUUID();
 const first=send({type:'REPLY_COPILOT_GENERATE',requestId:firstId,sourceText:'first public post',sourceUrl:'https://x.com/example/status/1'});
 await entered;await send({type:'REPLY_COPILOT_CANCEL',requestId:firstId});assert.equal(firstSignal.aborted,false);
 const second=send({type:'REPLY_COPILOT_GENERATE',requestId:secondId,sourceText:'second public post',sourceUrl:'https://x.com/example/status/2'});
 await new Promise(r=>setTimeout(r,5));assert.deepEqual(generated,[firstId]);finish();
 assert.equal((await first).ok,false);assert.equal((await second).ok,true);assert.deepEqual(generated,[firstId,secondId]);assert.equal(acked.size,2);
});
