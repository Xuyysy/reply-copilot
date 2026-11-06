import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';import {createRequire} from 'node:module';import {withMomentumBrowser} from '../helpers/momentum-browser.js';
const {build}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const root=process.cwd(),baseline='3cebe3ecbee552ef5b0e68afc7882a2dfb3869fa';
async function bundle(before){return (await build({stdin:{contents:`import {DeliveryCoordinator} from './services/delivery-coordinator.js';import {HostedAIClient} from './services/hosted-ai-client.js';import {momentumReceiptPatch,momentumReceiptKey,MomentumStore} from './services/creator-momentum.js';import {generatedHistory,generatedUsage} from './services/generation-records.js';import {DEFAULT_MOMENTUM_CONFIG} from './domain/creator-momentum.js';window.${before?'before':'after'}={DeliveryCoordinator,HostedAIClient,momentumReceiptPatch,momentumReceiptKey,MomentumStore,generatedHistory,generatedUsage,DEFAULT_MOMENTUM_CONFIG};`,resolveDir:root},plugins:before?[{name:'fixed-production-baseline',setup(b){b.onLoad({filter:/services\/delivery-coordinator\.js$/},()=>({contents:execFileSync('git',['show',baseline+':services/delivery-coordinator.js'],{encoding:'utf8'}),resolveDir:root+'/services'}));}}]:[],bundle:true,format:'iife',write:false})).outputFiles[0].text;}
const oldInline=execFileSync('git',['show',baseline+':content/inline-assistant.js'],{encoding:'utf8'}),newInline=readFileSync('content/inline-assistant.js','utf8'),presenter=readFileSync('content/momentum-presenter.js','utf8');
test('alternating real-browser A/B: fixed Production vs momentum; same mock AI/ACK/storage, display+native editable fill',{timeout:60000},async()=>{
 const html=`<div id="editor" contenteditable="true"></div><script>window.chrome={runtime:{getURL:()=>''}};${await bundle(true)};${await bundle(false)};${presenter};${oldInline};window.oldInline=ZaneReplyCopilotContent.inlineAssistant;${newInline};window.newInline=ZaneReplyCopilotContent.inlineAssistant;window.momentumReady=true;</script>`;
 await withMomentumBrowser(html,async({evaluate})=>{
 const report=await evaluate(`(async()=>{
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));const raw=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:'en',replies:{natural:'One specific observation.',light_humor:'A tiny plot twist for today.',thoughtful:'The detail makes a useful distinction.'},reason:'Relevant to the original post.',quoteCandidate:null});
  const samples={};let serial=0;const stats=new after.MomentumStore({name:'benchmark-only'});
  for(const scenario of ['paid_off','paid_on_below','paid_on_trigger','free_locked']){
   const rows={before:[],after:[]};
   for(let n=0;n<14;n++)for(const kind of (n%2?['after','before']:['before','after'])){
    const mod=window[kind],newCode=kind==='after',owner='bench-'+(++serial),calls=[],data={},policy={...mod.DEFAULT_MOMENTUM_CONFIG,enabled:true,...(scenario==='paid_on_trigger'?{ranges:[[1,1],[2,2],[3,3]]}:{})};let ackMs=0,reads=0,writes=0;
    const storage={get:async keys=>{reads++;await sleep(4);return structuredClone(data);},set:async values=>{writes++;await sleep(6);Object.assign(data,structuredClone(values));},remove:async key=>{delete data[key];}};
    const accountClient={request:async(path)=>{calls.push(path);await sleep(6);if(path==='/v1/ai/generate'){await sleep(35);return {raw};}if(path.endsWith('/delivered')){const start=performance.now();await sleep(12);ackMs=performance.now()-start;return {ok:true,quota:{totalRemaining:199}};}throw Error('Unexpected extra request '+path);}};
    const completion={keys:newCode?record=>['replyHistory','replyUsage',mod.momentumReceiptKey(record.ownerId,record.input.requestId)]:['replyHistory','replyUsage'],patch:(saved,receipt)=>{const meta={requestId:receipt.input.requestId,recommendation:'reply',createdAt:new Date().toISOString()};return {replyHistory:mod.generatedHistory(saved.replyHistory||[],meta),replyUsage:mod.generatedUsage(saved.replyUsage||[],meta),...(newCode?mod.momentumReceiptPatch(receipt,policy,saved[mod.momentumReceiptKey(receipt.ownerId,receipt.input.requestId)]):{})};}};
    const coordinator=new mod.DeliveryCoordinator({storage,getAccountId:async()=>owner,createClient:()=>new mod.HostedAIClient({config:{hostedApiUrl:'https://mock.invalid'},accountClient}),completion});
    if(newCode)await stats.view(owner,policy,{eligible:scenario!=='free_locked',enabled:scenario!=='paid_off'});
    const editor=document.getElementById('editor');editor.textContent='';
    const started=performance.now(),assistant=(newCode?newInline:oldInline).mount(editor,()=>{});
    if(newCode)assistant.setMomentum({available:true,eligible:scenario!=='free_locked',enabled:scenario!=='paid_off',policy});
    const result=JSON.parse(await coordinator.generateReplies({requestId:crypto.randomUUID(),sourceText:'Same fixed input for both variants.',sourceUrl:'https://x.com/synthetic/status/123'}));assistant.showResult(result.replies,'natural');const shown=performance.now()-started;
    editor.focus();const selection=getSelection();selection.selectAllChildren(editor);selection.collapseToEnd();if(!document.execCommand('insertText',false,result.replies.natural))throw Error('Synthetic native editor rejected insert');const filled=performance.now()-started;
    if(editor.textContent!==result.replies.natural)throw Error('Editor mismatch');
    if(calls.length!==2||calls[0]!=='/v1/ai/generate'||!calls[1].endsWith('/delivered'))throw Error('Normal path acquired extra HTTP');
    const blockingReads=reads,blockingWrites=writes;
    if(newCode){await stats.drain(storage);const view=await stats.view(owner,policy,{eligible:scenario!=='free_locked',claim:true});assistant.setMomentum(view);if(view.count!==1)throw Error('ACK count not exactly once');if(Boolean(view.reminder)!==(scenario==='paid_on_trigger'))throw Error('Scenario reminder mismatch');}
    assistant.close();if(n>=2)rows[kind].push({shown,filled,ackMs,http:calls.length,reads:blockingReads,writes:blockingWrites});
   }
   const summarize=xs=>{const quant=(k,q)=>xs.map(x=>x[k]).sort((a,b)=>a-b)[Math.ceil(xs.length*q)-1];return {samples:xs.length,display:{mean:xs.reduce((a,x)=>a+x.shown,0)/xs.length,p50:quant('shown',.5),p90:quant('shown',.9)},fill:{mean:xs.reduce((a,x)=>a+x.filled,0)/xs.length,p50:quant('filled',.5),p90:quant('filled',.9)},ack:{p50:quant('ackMs',.5),p90:quant('ackMs',.9)},normalHTTP:[...new Set(xs.map(x=>x.http))],preGenerateRecoveryHTTP:0,blockingStorageReads:[...new Set(xs.map(x=>x.reads))],blockingStorageWrites:[...new Set(xs.map(x=>x.writes))]};};
   samples[scenario]={before:summarize(rows.before),after:summarize(rows.after)};
  }
  return samples;
 })()`);
 writeFileSync('/private/tmp/xrh-momentum-performance.json',JSON.stringify({environment:'Isolated headless Chrome, synthetic post/editor and fixed mock AI. Not real X/vendor timings.',baseline,samples:report},null,2));
 for(const [scenario,r]of Object.entries(report)){assert.deepEqual(r.before.normalHTTP,[2]);assert.deepEqual(r.after.normalHTTP,[2]);assert.deepEqual(r.before.blockingStorageWrites,r.after.blockingStorageWrites);assert.deepEqual(r.before.blockingStorageReads,r.after.blockingStorageReads);assert.ok(r.after.fill.p90-r.before.fill.p90<Math.max(8,r.before.fill.p90*.1),scenario+' material regression');}
 console.log('Momentum alternating A/B report: '+JSON.stringify(report));
 });
});
