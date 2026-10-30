import test from 'node:test';
import assert from 'node:assert/strict';
import { DeliveryCoordinator } from '../services/delivery-coordinator.js';
const makeInput=(id='one')=>({requestId:id,sourceText:'post '+id,sourceUrl:'https://x.com/example/status/1',voiceProfile:{tone:'natural'},recentHistory:[],styleStats:{},replyStyle:'natural'});
function fixture(generate){const data={};let owner='account-a';const storage={get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))};const options={storage,getAccountId:async()=>owner,createClient:()=>({generateReplies:generate,lastQuota:{totalRemaining:19}})};return {coordinator:new DeliveryCoordinator(options),restart:()=>new DeliveryCoordinator(options),data,switchAccount:()=>owner='account-b'};}
test('closing the UI never aborts an accepted generation; the next call waits for its delivery',async()=>{
 let finish,started;const entered=new Promise(r=>started=r),calls=[];const f=fixture(async input=>{calls.push(input);assert.equal(input.signal,undefined);if(input.requestId==='one'){started();await new Promise(r=>finish=r);}return 'raw-'+input.requestId;});
 const ui=new AbortController(),first=f.coordinator.generateReplies({...makeInput(),signal:ui.signal});await entered;ui.abort();
 const second=f.coordinator.generateReplies(makeInput('two'));await new Promise(r=>setTimeout(r,0));assert.equal(calls.length,1);finish();
 assert.equal(await first,'raw-one');assert.equal(await second,'raw-two');assert.deepEqual(calls.map(x=>x.requestId),['one','two']);
});
test('lost delivery confirmation is recovered from an immutable original payload before a different generation',async()=>{
 const calls=[];let first=true;const f=fixture(async input=>{calls.push(structuredClone(input));if(first){first=false;throw Object.assign(new Error('ack lost'),{code:'DELIVERY_CONFIRMATION_PENDING'});}return 'raw-'+input.requestId;});
 const input=makeInput();await assert.rejects(f.coordinator.generateReplies(input));input.voiceProfile.tone='changed';
 assert.equal(await f.restart().generateReplies(makeInput('two')),'raw-two');assert.deepEqual(calls.map(x=>x.requestId),['one','one','two']);assert.equal(calls[1].voiceProfile.tone,'natural');
});
test('same request retry returns its retained result without another generation or debit',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;return 'valid-result';});assert.equal(await f.coordinator.generateReplies(makeInput()),'valid-result');assert.equal(await f.restart().generateReplies(makeInput()),'valid-result');assert.equal(calls,1);
 await assert.rejects(f.coordinator.generateReplies({...makeInput(),sourceText:'different'}),e=>e.code==='IDEMPOTENCY_CONFLICT');assert.equal(calls,1);
});
test('a still-running original prevents new work without an automatic retry loop',async()=>{
 const calls=[];const f=fixture(async input=>{calls.push(input.requestId);throw Object.assign(new Error('busy'),{code:'GENERATION_IN_PROGRESS'});});await assert.rejects(f.coordinator.generateReplies(makeInput()));await assert.rejects(f.coordinator.generateReplies(makeInput('two')));assert.deepEqual(calls,['one','one']);
});
test('changing accounts never replays another account pending input',async()=>{
 const calls=[];let fail=true;const f=fixture(async input=>{calls.push(input.requestId);if(fail){fail=false;throw Object.assign(new Error('network'),{code:'NETWORK_ERROR'});}return 'ok';});await assert.rejects(f.coordinator.generateReplies(makeInput()));f.switchAccount();assert.equal(await f.coordinator.generateReplies(makeInput('two')),'ok');assert.deepEqual(calls,['one','two']);
});
test('a queued UI cancelled before starting makes no new request',async()=>{
 let finish,started;const entered=new Promise(r=>started=r),calls=[];const f=fixture(async input=>{calls.push(input.requestId);started();await new Promise(r=>finish=r);return 'ok';});const first=f.coordinator.generateReplies(makeInput());await entered;const ui=new AbortController();const second=f.coordinator.generateReplies({...makeInput('two'),signal:ui.signal});ui.abort();finish();await first;await assert.rejects(second,e=>e.code==='REQUEST_CANCELLED');assert.deepEqual(calls,['one']);
});
test('a conclusively failed original is cleared before starting the requested next reply',async()=>{
 let attempt=0;const calls=[];const f=fixture(async input=>{calls.push(input.requestId);if(++attempt===1)throw Object.assign(new Error('network'),{code:'NETWORK_ERROR'});if(attempt===2)throw Object.assign(new Error('failed and released'),{code:'GENERATION_FAILED'});return 'ok';});await assert.rejects(f.coordinator.generateReplies(makeInput()));assert.equal(await f.coordinator.generateReplies(makeInput('two')),'ok');assert.deepEqual(calls,['one','one','two']);
});
test('retry preserves the original server payload when preferences or recent history have changed',async()=>{
 const calls=[];let first=true;const f=fixture(async input=>{calls.push(structuredClone(input));if(first){first=false;throw Object.assign(new Error('lost acknowledgement'),{code:'DELIVERY_CONFIRMATION_PENDING'});}return 'ok';});const input=makeInput();await assert.rejects(f.coordinator.generateReplies(input));input.voiceProfile.tone='changed';input.recentHistory.push({reply:'new selection'});assert.equal(await f.restart().generateReplies(input),'ok');assert.deepEqual(calls[0],calls[1]);
});

test('real hosted delivery handshake with a lost ACK consumes each original request exactly once',async()=>{
 const {HostedAIClient}=await import('../services/hosted-ai-client.js');
 const raw=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'en',reason:'Relevant.',quoteCandidate:null,replies:{natural:'One.',light_humor:'Two.',thoughtful:'Three.'}});
 const rows=new Map(),debited=new Set();let generations=0,loseAck=true;
 const data={},storage={get:async()=>structuredClone(data),set:async x=>Object.assign(data,structuredClone(x))};
 const accountClient={request:async(path,{body})=>{
  const id=body.requestId;
  if(path==='/v1/ai/generate'){
   if(!rows.has(id)){if([...rows.keys()].some(x=>!debited.has(x)))throw Object.assign(new Error('busy'),{code:'GENERATION_IN_PROGRESS'});rows.set(id,raw);generations++;}
   return {raw:rows.get(id)};
  }
  assert.ok(rows.has(id));debited.add(id);
  if(loseAck){loseAck=false;throw new Error('ACK response lost after atomic debit');}
  return {ok:true,quota:{totalRemaining:200-debited.size}};
 }};
 const create=()=>new DeliveryCoordinator({storage,getAccountId:async()=> 'same-account',createClient:()=>new HostedAIClient({config:{hostedApiUrl:'https://api.example.test'},accountClient})});
 const first={...makeInput(),requestId:'12345678-1234-4234-8234-123456789abc'},second={...makeInput('two'),requestId:'22345678-1234-4234-8234-123456789abc'};
 await assert.rejects(create().generateReplies(first),e=>e.code==='DELIVERY_CONFIRMATION_PENDING');
 assert.equal(await create().generateReplies(second),raw);
 assert.equal(generations,2);assert.equal(debited.size,2);
 assert.equal(await create().generateReplies(first),raw);assert.equal(generations,2);assert.equal(debited.size,2);
});


test('performance instrumentation is transient and never enters persisted replay payloads',async()=>{
 let received;const f=fixture(async input=>{received=input.performanceTrace;return 'ok';});
 const trace={enabled:true,measure:async(_name,fn)=>fn()};
 assert.equal(await f.coordinator.generateReplies({...makeInput(),performanceTrace:trace}),'ok');
 assert.equal(received,trace);
 assert.equal(JSON.stringify(f.data).includes('performanceTrace'),false);
 assert.equal(await f.restart().generateReplies(makeInput()),'ok');
});
