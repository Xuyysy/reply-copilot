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
 const accountClient={request:async(path,{body}={})=>{
  if(path==='/v1/ai/requests/active')return {state:[...rows.keys()].some(x=>!debited.has(x))?'running':'missing'};
  const match=path.match(/^\/v1\/ai\/requests\/([^/]+)$/);
  if(match)return rows.has(match[1])?{state:debited.has(match[1])?'delivered':'ready',requestId:match[1],raw:rows.get(match[1])}:{state:'missing',requestId:match[1]};
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

test('a timed-out queued operation never starts an unseen provider request later',async()=>{
 let finish,enter,phase='missing';const started=new Promise(r=>enter=r),calls=[];const data={};const c=new DeliveryCoordinator({waitTimeoutMs:15,storage:{get:async()=>structuredClone(data),set:async x=>Object.assign(data,structuredClone(x))},getAccountId:async()=> 'a',createClient:()=>({recoverGeneration:async id=>({state:id?phase:'missing',requestId:id||null}),generateReplies:async input=>{phase='running';calls.push(input.requestId);enter();await new Promise(r=>finish=r);return 'raw';}})});
 const first=c.generateReplies(makeInput('one'));await started;const second=c.generateReplies(makeInput('two'));await Promise.allSettled([first,second]);finish();await new Promise(r=>setTimeout(r,5));assert.deepEqual(calls,['one']);
});

test('invalid legacy-client output unblocks the next post without ACK, retry, or debit',async()=>{
 const {InvalidAIResponseError}=await import('../utils/errors.js');
 const old=makeInput('old'),next=makeInput('next'),data={pendingAiDelivery:{ownerId:'account-a',input:old,createdAt:Date.now()}};
 const storage={get:async()=>structuredClone(data),set:async value=>Object.assign(data,structuredClone(value))};
 const calls={status:0,ack:0,generate:[]};
 const coordinator=new DeliveryCoordinator({storage,getAccountId:async()=> 'account-a',createClient:()=>({
   recoverGeneration:async id=>{calls.status++;return {state:'ready',requestId:id,raw:'invalid-for-v1'};},
   receiveDelivery:async()=>{throw new InvalidAIResponseError('DeepSeek returned an invalid structured response. Try again.');},
   generateReplies:async input=>{calls.generate.push(input.requestId);return 'next-valid-reply';}
 })});
 assert.equal(await coordinator.generateReplies(next),'next-valid-reply');
 assert.deepEqual(calls.generate,['next'],'old request was NOT regenerated');
 assert.equal(calls.status,1,'at most one old-status recovery check');
 assert.equal(calls.ack,0,'invalid result was never confirmed/charged');
 assert.equal(data.pendingAiDelivery,null,'unusable old result does not block the next post');
});
test('invalid newly generated reply is retired locally; a future post can proceed',async()=>{
 const {InvalidAIResponseError}=await import('../utils/errors.js');
 const old=makeInput('old'),next=makeInput('next'),calls=[];
 const f=fixture(async input=>{calls.push(input.requestId);if(input.requestId==='old')throw new InvalidAIResponseError('invalid response');return 'good';});
 await assert.rejects(f.coordinator.generateReplies(old),e=>e.code==='CLIENT_RESPONSE_INCOMPATIBLE');
 assert.equal(f.data.pendingAiDelivery,null);
 assert.equal(await f.coordinator.generateReplies(next),'good');
 assert.deepEqual(calls,['old','next'],'no implicit extra paid generation');
});
test('ambiguous recovery/network failures still preserve the old request fence',async()=>{
 const old=makeInput('old'),next=makeInput('next'),data={pendingAiDelivery:{ownerId:'account-a',input:old,createdAt:Date.now()}};
 let count=0;
 const c=new DeliveryCoordinator({storage:{get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))},getAccountId:async()=> 'account-a',createClient:()=>({
  recoverGeneration:async()=>{throw Object.assign(new Error('unconfirmed network'),{code:'NETWORK_ERROR'});},
  generateReplies:async()=>{count++;return 'unexpected';}
 })});
 await assert.rejects(c.generateReplies(next),e=>e.code==='NETWORK_ERROR');
 assert.equal(count,0,'do not start new paid generation while delivery is uncertain');
 assert.equal(data.pendingAiDelivery.input.requestId,'old');
});

test('new post starts without waiting for an old hung client request',async()=>{
 const calls=[],data={},owner='account-a';
 const storage={get:async()=>structuredClone(data),set:async value=>Object.assign(data,structuredClone(value))};
 let oldStarted;const started=new Promise(r=>oldStarted=r),unresolved=new Promise(()=>{});
 const c=new DeliveryCoordinator({fastPostSwitch:true,storage,getAccountId:async()=>owner,createClient:()=>({
   recoverGeneration:async(id,abandon)=>{calls.push(['abandon',id,abandon]);return {state:'released',requestId:id};},
   generateReplies:async(input)=>{calls.push(['generate',input.requestId]);if(input.requestId==='old'){oldStarted();return unresolved;}return 'fresh-result';}
 }),waitTimeoutMs:50});
 const old=c.generateReplies(makeInput('old'));await started;
 const result=await c.generateReplies(makeInput('new'));
 assert.equal(result,'fresh-result');
 // The old promise is still unresolved when the new post already succeeds;
 // no wall-clock threshold or CI scheduling assumption is required.
 assert.deepEqual(calls,[['generate','old'],['generate','new']],'different Reply must not wait for old network recovery');
 assert.equal(data.pendingAiDelivery,null,'the new request must settle and clear its own local pending record');
 await assert.rejects(old,e=>e.code==='GENERATION_RECOVERY_REQUIRED');
});
test('fast switch A -> B -> A serializes same-ID retry without blocking B or starting another A provider call',async()=>{
 const data={},calls=[];let startOld,releaseOld;
 const started=new Promise(resolve=>startOld=resolve);
 const waitOld=new Promise(resolve=>releaseOld=resolve);
 const c=new DeliveryCoordinator({fastPostSwitch:true,waitTimeoutMs:2000,
  storage:{get:async()=>structuredClone(data),set:async x=>Object.assign(data,structuredClone(x))},
  getAccountId:async()=> 'account-a',
  createClient:()=>({generateReplies:async input=>{
   calls.push(input.requestId);
   if(input.requestId==='old'){startOld();await waitOld;}
   return 'raw-'+input.requestId;
  }})
 });
 const first=c.generateReplies(makeInput('old'));await started;
 assert.equal(await c.generateReplies(makeInput('new')),'raw-new');
 const retry=c.generateReplies(makeInput('old'));
 await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(calls,['old','new'],'same-ID retry must wait for its original provider while unrelated Reply stays non-blocking');
 releaseOld();
 assert.equal(await first,'raw-old');
 assert.equal(await retry,'raw-old');
 assert.deepEqual(calls,['old','new'],'only two distinct request IDs reach the provider');
});
test('hosted fast-switch interleaves two provider responses and ACKs independently without duplicate debit',async()=>{
 const {HostedAIClient}=await import('../services/hosted-ai-client.js');
 const raw=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'en',reason:'Relevant.',quoteCandidate:null,replies:{natural:'One.',light_humor:'Two.',thoughtful:'Three.'}});
 const firstId='11111111-1111-4111-8111-111111111111',secondId='22222222-2222-4222-8222-222222222222';
 const inputs=[firstId,secondId].map(requestId=>({...makeInput(requestId),requestId}));
 const data={},paths=[],debited=new Set();
 let releaseFirst,signalFirst;
 const firstGate=new Promise(resolve=>releaseFirst=resolve);
 const firstStarted=new Promise(resolve=>signalFirst=resolve);
 const request=async(path,options={})=>{
   const requestId=options.body?.requestId;
   if(path==='/v1/ai/generate'){
     paths.push('generate:'+requestId);
     if(requestId===firstId){signalFirst();await firstGate;}
     return {raw};
   }
   if(path.endsWith('/delivered')){
     paths.push('ack:'+requestId);
     debited.add(requestId);
     return {ok:true,quota:{totalRemaining:200-debited.size}};
   }
   throw new Error('Unexpected recovery call: '+path);
 };
 const options={fastPostSwitch:true,waitTimeoutMs:10000,
   storage:{get:async()=>structuredClone(data),set:async patch=>Object.assign(data,structuredClone(patch))},
   getAccountId:async()=> 'account-a',
   createClient:()=>new HostedAIClient({config:{hostedApiUrl:'https://isolated.invalid',requestTimeoutMs:10000},accountClient:{request}})
 };
 const coordinator=new DeliveryCoordinator(options);
 const original=coordinator.generateReplies(inputs[0]);
 try{
   await firstStarted;
   assert.equal(await coordinator.generateReplies(inputs[1]),raw);
   assert.equal(debited.has(firstId),false,'the old request has not been ACKed');
   assert.equal(debited.has(secondId),true,'the new request ACKs without waiting for old provider');
 }finally{releaseFirst();}
 assert.equal(await original,raw);
 assert.equal(debited.size,2,'both independent requests consume exactly once');
 assert.deepEqual(paths,['generate:'+firstId,'generate:'+secondId,'ack:'+secondId,'ack:'+firstId]);
 const restarted=new DeliveryCoordinator(options);
 assert.equal(await restarted.generateReplies(inputs[0]),raw);
 assert.equal(await restarted.generateReplies(inputs[1]),raw);
 assert.equal(paths.length,4,'finished requests replay locally without extra generate or ACK');
 assert.deepEqual(new Set(data.completedAiDeliveries.map(row=>row.input.requestId)),new Set([firstId,secondId]));
});

test('new post starts while the old server-running orphan remains independent',async()=>{
 const old=makeInput('old'),fresh=makeInput('new'),data={pendingAiDelivery:{ownerId:'account-a',input:old,createdAt:Date.now()}};
 let abandon=0,generate=0;
 const c=new DeliveryCoordinator({fastPostSwitch:true,storage:{get:async()=>structuredClone(data),set:async value=>Object.assign(data,structuredClone(value))},
   getAccountId:async()=> 'account-a',createClient:()=>({
   recoverGeneration:async(id,flag)=>{assert.equal(id,'old');assert.equal(flag,true);abandon++;return {state:'released',requestId:id};},
   generateReplies:async input=>{assert.equal(input.requestId,'new');generate++;return 'fresh-result';}
 })});
 assert.equal(await c.generateReplies(fresh),'fresh-result');
 assert.equal(abandon,0);assert.equal(generate,1);
});
test('new post does not regenerate an old missing request or repeat an old AI call',async()=>{
 const old=makeInput('old'),fresh=makeInput('new'),data={pendingAiDelivery:{ownerId:'account-a',input:old,createdAt:Date.now()}};
 const calls=[];
 const c=new DeliveryCoordinator({fastPostSwitch:true,storage:{get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))},
   getAccountId:async()=> 'account-a',createClient:()=>({
   recoverGeneration:async(id,abandon)=>{calls.push(['retire',id,abandon]);return {state:'released',requestId:id};},
   generateReplies:async input=>{calls.push(['generate',input.requestId]);return 'fresh-result';}
 })});
 assert.equal(await c.generateReplies(fresh),'fresh-result');
 assert.deepEqual(calls,[['generate','new']],'new request never waits on old abandonment');
});
test('an unrelated old provider uncertainty never blocks a newly reserved request',async()=>{
 const old=makeInput('old'),fresh=makeInput('new'),data={pendingAiDelivery:{ownerId:'account-a',input:old,createdAt:Date.now()}};
 let generated=0;
 const c=new DeliveryCoordinator({fastPostSwitch:true,storage:{get:async()=>structuredClone(data),set:async v=>Object.assign(data,structuredClone(v))},
   getAccountId:async()=> 'account-a',createClient:()=>({
   recoverGeneration:async()=>{throw Object.assign(new Error('unsafe'),{code:'RECOVERY_NOT_SAFE'});},
   generateReplies:async()=>{generated++;return 'should-not-execute';}
 })});
 assert.equal(await c.generateReplies(fresh),'should-not-execute');
 assert.equal(generated,1,'different Reply must use its own request ID and server quota');
 assert.equal(data.pendingAiDelivery,null,'new request only clears its own local pending state');
});
