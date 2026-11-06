// Local simulation only: real content/background/client/provider orchestration,
// synthetic editor, synthetic D1 boundaries and a non-network model transport.
import vm from 'node:vm';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
const {buildSync}=createRequire(new URL('../../api/package.json',import.meta.url))('esbuild');
const bundles=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function generationFixture({sourceRoot,scenario='english-short',options={}}){
 if(!bundles.has(sourceRoot))bundles.set(sourceRoot,buildSync({entryPoints:[path.join(sourceRoot,'background/service-worker.js')],bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'}).outputFiles[0].text);
 const {requestConfiguredModel}=await import(pathToFileURL(path.join(sourceRoot,'api/src/ai-model-provider.js')).href);
 const {executeAiGeneration}=await import(pathToFileURL(path.join(sourceRoot,'api/src/ai-generation-flow.js')).href);
 const {buildPrompts}=await import(pathToFileURL(path.join(sourceRoot,'prompts/prompt-builder.js')).href);
 const timers=new Set(),listeners={},observerCallbacks=[],calls={generations:0,acks:0,debits:0,insertions:0},saved={},sessionValues={generationPerformanceEnabled:options.diagnostics!==false};
 const apiTimings=[],paths=[],marks={},times={},outputs=[],providerBodies=[];let nowEditor=null,closed=false;
 const start=performance.now(),at=()=>performance.now()-start;
 const timed=fn=>(callback,ms,...args)=>{const id=fn(callback,ms,...args);timers.add(id);id.unref?.();return id;};
 const event=()=>({addListener(fn){this.listener=fn;},removeListener(){}});
 const requestId=randomUUID();
 const text=scenario.startsWith('chinese')?'今天开始记录每天学到的一件小事，过程比结果更值得耐心。':'Small daily observations make slow progress easier to notice.';
 const sourceText=text+(scenario.endsWith('long')?('\n'+text).repeat(18):'');
 const output=JSON.stringify({recommendation:'reply',defaultStyle:'natural',language:scenario.startsWith('chinese')?'zh':'en',replies:{natural:'That small detail is worth noticing.',light_humor:'My to-do list could use that kind of patience.',thoughtful:'Consistent attention often makes progress visible.'},reason:'Reflects the post.',quoteCandidate:null});
 const local={
  async get(keys){await sleep(keys==='replyHistory'?6:4);if(keys===null)return structuredClone(saved);if(typeof keys==='string')return {[keys]:saved[keys]};return Object.fromEntries(keys.map(k=>[k,saved[k]]));},
  async set(value){await sleep(6);Object.assign(saved,structuredClone(value));},async remove(keys){for(const key of [].concat(keys))delete saved[key];},
 };
 saved.replyCopilotAccountToken='fixture-account-token';
 const {DEFAULT_VOICE_PROFILE}=await import(pathToFileURL(path.join(sourceRoot,'domain/voice-profile.js')).href);
 saved.voiceProfile={...DEFAULT_VOICE_PROFILE,tone:scenario.includes('long')?'balanced_thoughtful':'relaxed_friendly',writingSamples:['A short personal writing sample.'],updatedAt:null};
 saved.replyHistory=[{reply:'A previously chosen reply.',style:'natural',events:['selected']}];
 const session={async get(keys){await sleep(2);return typeof keys==='string'?{[keys]:sessionValues[keys]}:Object.fromEntries(keys.map(k=>[k,sessionValues[k]]));},async set(value){await sleep(2);Object.assign(sessionValues,structuredClone(value));}};
 const originalFetch=globalThis.fetch;
 const dnsFetch=async(url,init)=>{
  if(!String(url).startsWith('https://cloudflare-dns.com/dns-query?'))throw Error('External network forbidden');
  const type=new URL(url).searchParams.get('type');const begin=at();marks.dns_start??=begin;await sleep(type==='A'?9:13);
  times['dns_'+type]=(times['dns_'+type]||0)+at()-begin;marks.dns_end=at();
  return Response.json({Status:0,Answer:type==='A'?[{type:1,data:options.dnsPrivate?'127.0.0.1':'93.184.216.34'}]:[]});
 };
 globalThis.fetch=dnsFetch;
 const routeApi=async(url,init)=>{
  const parsed=new URL(url);if(parsed.origin!=='http://127.0.0.1:8787')throw Error('Unexpected API');
  const p=parsed.pathname;paths.push(p);await sleep(options.networkRoundTripMs??6);
  if(options.offline)throw Error('fixture offline');
  if(p==='/v1/me')return Response.json({user:{userId:'fixture-owner',username:'fixture'}});
  if(p==='/v1/entitlements')return Response.json({status:options.quotaExhausted?'credits_exhausted':'credits_available',entitlement:{},...(options.momentumFeature?{features:{interactionMomentum:options.momentumFeature}}:{})});
  if(p==='/v1/usage')return Response.json({quota:{totalRemaining:options.quotaExhausted?0:200-calls.debits}});
  if(p==='/v1/ai/requests/active'||/^\/v1\/ai\/requests\/[^/]+$/.test(p))return Response.json({state:'missing'});
  const body=JSON.parse(init.body||'{}');
  if(p==='/v1/ai/generate'){
   const prompts=buildPrompts({postContext:body.post,voiceProfile:body.voiceProfile,recentHistory:body.recentHistory,styleStats:body.styleStats,replyStyle:body.replyStyle});
   const generated=await executeAiGeneration({reserve:async()=>{marks.reserve_start=at();await sleep(4);marks.reserved=at();return {kind:'reserved'};},provider:()=>requestConfiguredModel({config:{provider:'qwen',protocol:'openai_chat',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',modelId:'fixture-model',timeoutMs:5000,maxOutputTokens:1200,options:{}},apiKey:'fixture-only-key',system:prompts.system,user:prompts.user,inputRateMicroUsdPerMillion:100000,outputRateMicroUsdPerMillion:100000,reservedCostMicroUsd:5000,fetchImpl:async(_url,providerInit)=>{calls.generations++;marks.model_start=at();providerBodies.push(JSON.parse(providerInit.body));if(options.onGenerating)options.onGenerating();if(options.closeDuringGeneration)closeComposer();if(options.draftDuringGeneration){nowEditor.text='User draft';nowEditor.inputListener?.();}await sleep(35);marks.model_end=at();return Response.json({choices:[{finish_reason:'stop',message:{content:options.invalidOutput?'{}':output}}],usage:{prompt_tokens:979,completion_tokens:149}});}}),validate:()=>{},finish:async()=>{await sleep(4);marks.stored=at();}});
   if(generated.kind==='failed')return Response.json({code:'AI_PROVIDER_UNAVAILABLE',message:'Fixture provider failure'},{status:503});
   return Response.json({raw:generated.raw,quota:{totalRemaining:200-calls.debits}});
  }
  if(p.endsWith('/delivered')){calls.acks++;marks.ack_start=at();await sleep(12);if(options.ackLost)return Response.json({code:'DELIVERY_CONFIRMATION_PENDING',message:'Fixture ACK unavailable'},{status:503});if(!calls.debits)calls.debits=1;marks.ack_end=at();return Response.json({ok:true,quota:{totalRemaining:199}});}
  throw Error('Unmocked API path');
 };
 const fetchApi=async(url,init)=>{const begin=at(),path=new URL(url).pathname;try{return await routeApi(url,init);}finally{apiTimings.push({path,durationMs:at()-begin});}};
 const chrome={runtime:{id:'fixture-extension',onInstalled:event(),onMessage:event(),getURL:p=>p},contextMenus:{onClicked:event()},storage:{local,session,onChanged:event()},tabs:{query:async()=>[],sendMessage:async()=>{}},sidePanel:{}};
 const common={console,URL,Response,AbortController,TextEncoder,structuredClone,crypto:{randomUUID},setTimeout:timed(setTimeout),clearTimeout,setInterval:timed(setInterval),clearInterval,performance,fetch:fetchApi,chrome};
 const background=vm.createContext({...common});vm.runInContext(bundles.get(sourceRoot),background);
 const backgroundListener=chrome.runtime.onMessage.listener;
 const control={closest:selector=>selector==='article'?{}:null};
 const editor={isConnected:true,text:'',parentElement:{isConnected:true},addEventListener(_name,fn){this.inputListener=fn;},removeEventListener(){}};nowEditor=editor;
 const document={body:{},visibilityState:'visible',activeElement:editor,hasFocus:()=>true,addEventListener(name,fn){listeners[name]=fn;},removeEventListener(){}};
 let appliedResolve;const applied=new Promise(r=>appliedResolve=r);
 const assistant={host:{isConnected:true,remove(){this.isConnected=false;},contains:()=>false},setStatus(message){outputs.push(message);},showAccount(){},showReady(){},showLoading(){},setAccountLabel(){},showResult(){marks.candidates=at();},showApplied(){marks.verified=at();appliedResolve();},showRetry(){},close(){this.host.remove();}};
 const api={replyDetector:{findReplyControl:()=>control},postExtractor:{extractPost:()=>({ok:true,statusId:'123456',sourceText,sourceUrl:'https://x.com/fixture/status/123456'})},composerAssociation:{capturePost:x=>x,baseline:()=>({baselineModalCount:closed?0:1,visibleReplyEditorCount:closed?0:1}),snapshot:()=>({editors:closed?[]:[{editor}],visibleDialogCount:closed?0:1}),create:()=>({interrupt(){},evaluate:()=>closed?{state:'rejected',reason:'editor_replaced_or_closed'}:{state:'bound',editor}})},composerAdapter:{hasContent:e=>!!e?.text,focusEmpty:e=>!e.text,readText:e=>e.text,insertOnce(e,_id,candidate,valid){if(!valid())return false;calls.insertions++;e.text=candidate;marks.insert=at();e.inputListener?.();return true;}},inlineAssistant:{mount:()=>assistant}};
 const contentChrome={runtime:{id:chrome.runtime.id,onMessage:event(),sendMessage:message=>new Promise(resolve=>{const returned=backgroundListener(message,{id:chrome.runtime.id,url:'https://x.com/home',frameId:0,tab:{id:1}},response=>{if(message.type==='REPLY_COPILOT_GENERATE')marks.background_return=at();resolve(response);});if(returned===false)resolve(null);})}};
 const content=vm.createContext({...common,chrome:contentChrome,document,location:{href:'https://x.com/home'},window:{addEventListener(){},removeEventListener(){}},MutationObserver:class{constructor(callback){observerCallbacks.push(callback);}observe(){}disconnect(){}},ZaneReplyCopilotContent:api});
 const perfFile=path.join(sourceRoot,'utils/generation-performance.js');if(existsSync(perfFile))vm.runInContext(readFileSync(perfFile,'utf8'),content);
 vm.runInContext(readFileSync(path.join(sourceRoot,'content/content-script.js'),'utf8'),content);
 function closeComposer(){closed=true;editor.isConnected=false;observerCallbacks.forEach(fn=>fn([]));}
 try{
  // Wait for diagnostics opt-in to load. No preflight/account warm-up.
  await sleep(10);
  const clickAt=at();marks.click=clickAt;
  listeners.pointerdown({isTrusted:true,type:'pointerdown',target:control});listeners.click({isTrusted:true,type:'click',target:control});
  if(options.waitForFailure){await sleep(250);}else await Promise.race([applied,sleep(options.deadlineMs||1000).then(()=>{throw Error('Fixture did not apply: '+outputs.join(';'));})]);
  return {scenario,calls,momentumOutboxCount:Object.keys(saved).filter(k=>k.startsWith("creatorMomentumDelivery:")).length,requestPaths:paths,apiTimings,elapsedMs:marks.verified==null?null:marks.verified-clickAt,marks:Object.fromEntries(Object.entries(marks).map(([k,v])=>[k,v-clickAt])),dns:times.dns_A+times.dns_AAAA,report:content.replyCopilotPerformanceReport?.(),messages:outputs,promptHashes:providerBodies.map(body=>createHash('sha256').update(JSON.stringify(body)).digest('hex'))};
 }finally{for(const timer of timers){clearTimeout(timer);clearInterval(timer);}globalThis.fetch=originalFetch;}
}
