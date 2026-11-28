import {openInteractionDB,beginSession,endSession,readOwnerDataset,clearOwner,commitBatch} from '../interaction-manager/storage/repository.js';
import {syncInteractions} from '../interaction-manager/sync/engine.js';
import {openProviderSession} from '../interaction-manager/sync/provider-session.js';
import {createXInteractionProviderFactory} from './interaction-provider.js';
import {validId,normalizeEvent} from '../interaction-manager/core/events.js';
import {safeSyncDiagnostic,safeObservationCounts} from '../interaction-manager/sync/diagnostic.js';
import {createSchedulePreferences} from '../interaction-manager/sync/schedule-preferences.js';
const TYPE='XRH_STAGING_ACCOUNT_WORKBENCH';
const PATHS=Object.freeze({interaction:'staging/interaction-workbench.html',follow:'staging/follow-workbench.html'});
const idOk=v=>Number.isInteger(v)&&v>=0;
const ownerOk=v=>validId(v?.ownerUserId)&&typeof v.handle==='string'&&/^[a-z0-9_]{1,15}$/i.test(v.handle);
const same=(a,b)=>ownerOk(a)&&ownerOk(b)&&a.ownerUserId===b.ownerUserId&&a.handle.toLowerCase()===b.handle.toLowerCase();
const fail=code=>{throw Error(code)};
const errors=new Set(['owner_unverified','identity_changed','source_unavailable','busy','invalid_context','cancelled','workspace_limit']);
export function createAccountWorkbenchController({chromeApi=chrome,openDB=openInteractionDB,providerFactory=null}={}){
 const c=chromeApi,locks=new Map(),jobs=new Map();let db,dbQueue=Promise.resolve(),sampleTicket=null,sampleCommit=null;
 const taskKey=owner=>'xrh-interaction-task-'+owner;
 const reasonSet=new Set(['source_exhausted','page_limit','time_limit','cancelled','identity_changed','owner_mismatch','unauthenticated','forbidden','rate_limited','source_unavailable','schema_changed','workspace_limit','sync_failed','source_error','session_limit','owner_unverified','endpoint_not_observed','open_notifications','invalid_cursor','ambiguous_cursor','terminal_unverified','response_mismatch','invalid_pagination','cursor_cycle','stale_session','stale_checkpoint','history_limit','invalid_job','invalid_checkpoint']);
 const inDB=fn=>{const p=dbQueue.then(fn,fn);dbQueue=p.catch(()=>{});return p;};
 const key=f=>'xrh-workbench-'+f;
 const store=c.storage.session;
 // Only noncredential task summaries persist across a browser restart.
 // Tab bindings stay session-only; opening a new workbench rechecks identity.
 const taskStore=c.storage.local??store;
 const schedulePreferences=createSchedulePreferences(taskStore);
 const get=async f=>(await store.get(key(f)))[key(f)]??null;
 const put=(f,v)=>store.set({[key(f)]:v});
 const readTask=async owner=>{
   const k=taskKey(owner);
   const v=(await taskStore.get(k))[k]??(taskStore!==store?(await store.get(k))[k]:null);
   if(!v||v.ownerUserId!==owner)return null;
   const active=jobs.get(owner);
   if(v.state==='running')return active?{...v,...active.progress}:{...v,state:'interrupted',reason:'interrupted'};
   return v;
 };
 const saveTask=(owner,v)=>taskStore.set({[taskKey(owner)]:{ownerUserId:owner,...v}});
 const path=f=>c.runtime.getURL(PATHS[f]);
 async function identity(tabId){
   if(!idOk(tabId))fail('owner_unverified');
   let r,timer;try{r=await Promise.race([c.tabs.sendMessage(tabId,{type:'XRH_STAGING_WORKBENCH_IDENTITY'}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('owner_unverified')),2000);})]);}finally{clearTimeout(timer);}
   if(!r?.ok||!ownerOk(r.value))fail('owner_unverified');return {ownerUserId:r.value.ownerUserId,handle:r.value.handle.toLowerCase()};
 }
 async function verified(f,sender){
   const b=await get(f);if(!b||sender.tab?.id!==b.workbenchTabId||sender.url!==path(f))fail('invalid_context');
   const current=await identity(b.sourceTabId);if(!same(b,current))fail('identity_changed');
   // Re-read binding after async identity probe; a new open may have replaced it.
   const after=await get(f);if(after?.bindingId!==b.bindingId||after.sourceTabId!==b.sourceTabId)fail('identity_changed');return b;
 }
 async function open(f){
   const [tab]=await c.tabs.query({active:true,currentWindow:true});
   const i=await identity(tab?.id),prior=await get(f);
   if(prior&&same(prior,i)){
     try{await c.tabs.get(prior.workbenchTabId);await put(f,{...prior,sourceTabId:tab.id});await c.tabs.update(prior.workbenchTabId,{active:true});return {opened:true};}catch{}
   }
   // No hidden X tabs, navigation or automatic remote calls.
   const t=await c.tabs.create({url:path(f),active:false});
   if(!idOk(t?.id))fail('invalid_context');
   await put(f,{...i,sourceTabId:tab.id,workbenchTabId:t.id,bindingId:crypto.randomUUID()});
   await c.tabs.update(t.id,{active:true});return {opened:true};
 }
 async function read(f,sender,{clear=false}={}){
   const b=await verified(f,sender);
   if(f==='follow')return {identity:{ownerUserId:b.ownerUserId,handle:b.handle},sourceReady:false};
   const verifyOriginal=async()=>{const current=await verified(f,sender);if(current.bindingId!==b.bindingId||current.sourceTabId!==b.sourceTabId||!same(current,b))fail('identity_changed');};
   const task=await readTask(b.ownerUserId);
   await verifyOriginal();
   if(jobs.size){if(clear)fail('busy');return {identity:{ownerUserId:b.ownerUserId,handle:b.handle},running:jobs.has(b.ownerUserId),busy:true,task,sourceReady:!!providerFactory};}
   return inDB(async()=>{
   await verifyOriginal();
   if(jobs.size){if(clear)fail('busy');return {identity:{ownerUserId:b.ownerUserId,handle:b.handle},running:jobs.has(b.ownerUserId),busy:true,task:await readTask(b.ownerUserId),sourceReady:!!providerFactory};}
   db??=await openDB();
   const session=await beginSession(db,b.ownerUserId);
   try{
     await verifyOriginal();
     if(clear){sampleTicket=null;await clearOwner(db,session);await saveTask(b.ownerUserId,{state:'idle',updatedAt:Date.now()});}
     const dataset=await readOwnerDataset(db,session);
     const latestTask=await readTask(b.ownerUserId);
     await verifyOriginal();
     return {identity:{ownerUserId:b.ownerUserId,handle:b.handle},dataset,sourceReady:!!providerFactory,running:false,task:latestTask};
   }finally{await endSession(db,session);}
   });
 }
 // Only the Staging registration injects the read-only X provider. Test callers
 // remain fail-closed without an explicit factory. Tasks outlive the workbench page.
 async function startSync(f,sender,authorized,selectedSource='both',syncMode='history'){
   const b=await verified(f,sender);
   if(f!=='interaction'||!providerFactory)fail('source_unavailable');
   if(authorized!==true||!['both','notification','post'].includes(selectedSource)||!['history','recent'].includes(syncMode))fail('invalid_context');
   if(jobs.has(b.ownerUserId))return {running:true};
   if(jobs.size||sampleCommit||sampleTicket&&sampleTicket.expires>Date.now())fail('busy');
   const task={controller:new AbortController(),runId:crypto.randomUUID(),progress:{pages:0,inserted:0,sources:[],...(syncMode==='recent'?{syncMode}:{})}};jobs.set(b.ownerUserId,task);
   // Preserve write order so a late progress update cannot overwrite final status.
   let taskWrites=Promise.resolve();
   const write=(state,reason=null)=>{
     const value={runId:task.runId,state,reason,...task.progress,updatedAt:Date.now()};
     const pending=taskWrites.then(()=>saveTask(b.ownerUserId,value));
     taskWrites=pending.catch(()=>{});
     return pending;
   };
   try{await write('running');}catch(e){jobs.delete(b.ownerUserId);throw e;}
   task.promise=inDB(async()=>{let reason='sync_failed',provider,stage='identity';try{
     const verifyBound=async()=>{
       if(task.controller.signal.aborted)fail('cancelled');
       const bound=await get(f);if(bound?.bindingId!==b.bindingId||bound.sourceTabId!==b.sourceTabId)fail('identity_changed');
       const current=await identity(b.sourceTabId);if(!same(b,current))fail('identity_changed');
       const after=await get(f);if(after?.bindingId!==b.bindingId||after.sourceTabId!==b.sourceTabId)fail('identity_changed');
     };
     await verifyBound();
     stage='connect';
     provider=await openProviderSession(providerFactory,b,{signal:task.controller.signal});
     if(!provider||typeof provider.identify!=='function'||typeof provider.readPage!=='function')fail('source_unavailable');
     const guarded={identify:async arg=>{await verifyBound();return provider.identify(arg);},readPage:async arg=>{await verifyBound();return provider.readPage(arg);}};
     // One owner-bound task can cover both timeline kinds. Each kind retains an
     // independent durable checkpoint in the existing repository.
     const available=provider.sources===undefined?['notification']:provider.sources;
     if(!Array.isArray(available)||available.length<1||available.length>2||new Set(available).size!==available.length||available.some(s=>!['notification','post'].includes(s)))fail('source_unavailable');
     const sources=selectedSource==='both'?available:available.filter(source=>source===selectedSource);
     if(sources.length===0)fail('source_unavailable');
     stage='checkpoint';
     db??=await openDB();
     const session=await beginSession(db,b.ownerUserId);
     let prior;
     try{prior=await readOwnerDataset(db,session);}finally{await endSession(db,session);}
     let completedPages=0,completedInserted=0,partialReason=null;
     // Incomplete/oldest sources get a turn before refreshing completed history.
     const sourceId=source=>provider.sourceIds?.[source]??provider.id;
     const checkpoint=source=>prior.jobs.find(j=>j.providerId===sourceId(source)&&j.source===source)??prior.jobs.find(j=>j.providerId===provider.id&&j.source===source);
     const ordered=[...sources].sort((a,b)=>Number(checkpoint(a)?.done===true)-Number(checkpoint(b)?.done===true)||(checkpoint(a)?.updatedAt??0)-(checkpoint(b)?.updatedAt??0));
     const pagesPerSource=syncMode==='recent'?3:Math.floor(30/sources.length),msPerSource=Math.floor(80000/sources.length);
     task.progress={...task.progress,sources:ordered.map(source=>({source,state:'pending',reason:null,pages:0,inserted:0}))};
     const sourceProgress=(source,fields)=>{task.progress={...task.progress,sources:task.progress.sources.map(s=>s.source===source?{...s,...fields}:s)};};
     for(const source of ordered){
       stage='identity';
       await verifyBound();
       const refresh=checkpoint(source)?.done===true;
       const id=sourceId(source),scoped={...guarded,id,...(id!==provider.id?{legacyProviderId:provider.id}:{})};
       sourceProgress(source,{state:'running'});
       const result=await syncInteractions(db,scoped,{ownerUserId:b.ownerUserId,source,refresh,recentOnly:syncMode==='recent',maxPages:pagesPerSource,maxMs:msPerSource,signal:task.controller.signal,onProgress:p=>{
         task.progress={...task.progress,pages:completedPages+p.pages,inserted:completedInserted+p.inserted};
         const counts=safeObservationCounts(p.counts,p.pages,p.inserted);
         sourceProgress(source,{pages:p.pages,inserted:p.inserted,...(counts?{counts}:{})});
         void write('running').catch(()=>{});
       }});
       completedPages+=result.committed;completedInserted+=result.inserted;
       task.progress={...task.progress,pages:completedPages,inserted:completedInserted};
       reason=reasonSet.has(result.reason)?result.reason:'sync_failed';
       const counts=safeObservationCounts(result.counts,result.committed,result.inserted);
       sourceProgress(source,{state:'stopped',reason,pages:result.committed,inserted:result.inserted,...(counts?{counts}:{}),...(result.diagnostic&&reason!=='cancelled'?{diagnostic:safeSyncDiagnostic(result.diagnostic.stage,result.diagnostic.reason,result.diagnostic.httpStatus,result.diagnostic)}:{})});
       // A page budget boundary has no in-flight read. Allow the other source
       // its reserved pages, but never hide the partial result behind success.
       if(reason==='page_limit')partialReason='page_limit';
       if(!['source_exhausted','page_limit'].includes(reason))break;
     }
     if(reason==='source_exhausted'&&partialReason)reason=partialReason;
   }catch(e){reason=reasonSet.has(e?.message)?e.message:'sync_failed';if(reason!=='cancelled')task.progress={...task.progress,diagnostic:safeSyncDiagnostic(stage,reason)};}
   finally{
     task.progress={...task.progress,sources:task.progress.sources.map(s=>s.state==='running'?{...s,state:'stopped',reason}:s)};
     try{await provider?.close();await write('stopped',reason);}finally{jobs.delete(b.ownerUserId);}
   }});
   task.promise.catch(()=>{});
   return {running:true};
 }
 // DevTools is a trusted extension page, not a web-page message bridge.
 async function observedSample(m,sender){
   if(sender.url!==c.runtime.getURL('staging/interaction-response-panel.html')||m.feature!=='interaction'||!idOk(m.tabId))fail('invalid_context');
   if(m.action==='sample-cancel'){
     if(sampleTicket?.id===m.ticket&&sampleTicket.tabId===m.tabId)sampleTicket=null;
     if(sampleCommit?.id===m.ticket&&sampleCommit.tabId===m.tabId)sampleCommit.controller.abort();
     return {stopped:true};
   }
   const b=await get('interaction');
   if(!b||b.sourceTabId!==m.tabId)fail('invalid_context');
   const verify=async()=>{
     const before=await get('interaction');
     if(before?.bindingId!==b.bindingId||before.sourceTabId!==m.tabId||!same(before,b)||!same(await identity(m.tabId),b))fail('identity_changed');
     const after=await get('interaction');
     if(after?.bindingId!==b.bindingId||after.sourceTabId!==m.tabId||!same(after,b))fail('identity_changed');
   };
   if(m.action==='sample-start'){
     const maxPages=m.maxPages??1;
     if(m.authorized!==true||![1,5].includes(maxPages)||!['notification','post'].includes(m.source))fail('invalid_context');
     if(jobs.size||sampleCommit||sampleTicket&&sampleTicket.expires>Date.now())fail('busy');
     await verify();
     if(jobs.size||sampleCommit||sampleTicket&&sampleTicket.expires>Date.now())fail('busy');
     sampleTicket={id:crypto.randomUUID(),tabId:m.tabId,bindingId:b.bindingId,ownerUserId:b.ownerUserId,source:m.source,expires:Date.now()+60000,maxPages,sequence:1};
     return {ticket:sampleTicket.id,ownerUserId:b.ownerUserId};
   }
   const t=sampleTicket;
   if(!t||t.id!==m.ticket||t.tabId!==m.tabId||t.bindingId!==b.bindingId||t.ownerUserId!==b.ownerUserId||t.expires<=Date.now()||(m.sequence??1)!==t.sequence)fail('invalid_context');
   sampleTicket=null; // Consume this sequence before any asynchronous commit.
   if(jobs.size||sampleCommit)fail('busy');
   const observedAt=Date.now();
   if(!Array.isArray(m.events)||m.events.length>1000||!Array.isArray(m.users)||m.users.length>2000)fail('invalid_context');
   const events=m.events.map(e=>normalizeEvent({...e,observedAt},b.ownerUserId));
   if(events.some(e=>!e||e.source!==t.source||e.direction!=='inbound'))fail('invalid_context');
   const users=m.users.filter(u=>validId(u?.userId)&&typeof u.handle==='string'&&/^[A-Za-z0-9_]{1,15}$/.test(u.handle)).map(u=>({userId:u.userId,handle:u.handle,observedAt}));
   const pending={...t,controller:new AbortController()};sampleCommit=pending;
   const signal=pending.controller.signal;
   const check=()=>{if(signal.aborted)fail('cancelled');if(jobs.size||t.expires<=Date.now())fail('busy');};
   try{return await inDB(async()=>{
     check();await verify();check();
     db??=await openDB();check();
     const session=await beginSession(db,b.ownerUserId);
     try{
       await verify();check();
       const result=await commitBatch(db,session,events,{source:t.source,observedAt,users,observedSample:true,signal});
       if(!signal.aborted&&t.sequence<t.maxPages&&t.expires>Date.now())sampleTicket={...t,sequence:t.sequence+1};
       return {inserted:result.inserted,accepted:result.accepted,source:t.source,historyComplete:false};
     }finally{await endSession(db,session);}
   });}finally{if(sampleCommit===pending)sampleCommit=null;}
 }
 async function dispatch(m,sender){
   if(m?.type!==TYPE||sender.id!==c.runtime.id||!Object.hasOwn(PATHS,m.feature))fail('invalid_context');
   const f=m.feature;
   if(['sample-start','sample-commit','sample-cancel'].includes(m.action))return observedSample(m,sender);
   if(m.action==='open'){
     if(sender.url!==c.runtime.getURL('sidepanel/sidepanel.html'))fail('invalid_context');
     if(locks.has(f))return locks.get(f);
     const p=open(f);locks.set(f,p);try{return await p;}finally{locks.delete(f);}
   }
   // Preference-only controls; no enable/start action or background request.
   if(m.action==='schedule-preferences'||m.action==='schedule-interval'){
     if(f!=='interaction')fail('invalid_context');
     const b=await verified(f,sender);
     if(m.action==='schedule-interval'&&![30,60,120].includes(m.intervalMinutes))fail('invalid_context');
     const v=m.action==='schedule-interval'?await schedulePreferences.write(b.ownerUserId,m.intervalMinutes):await schedulePreferences.read(b.ownerUserId);
     const after=await verified(f,sender);if(after.bindingId!==b.bindingId||after.sourceTabId!==b.sourceTabId||!same(b,after))fail('identity_changed');
     return v;
   }
   if(m.action==='view')return read(f,sender);
   if(m.action==='identity'){const b=await verified(f,sender);return {ownerUserId:b.ownerUserId,handle:b.handle,bindingId:b.bindingId};}
   if(m.action==='clear'){if(m.confirmed!==true||f!=='interaction')fail('invalid_context');return read(f,sender,{clear:true});}
   if(m.action==='sync')return startSync(f,sender,m.authorized,m.selectedSource,m.syncMode);
   if(m.action==='stop'){const b=await verified(f,sender);if(f!=='interaction')fail('invalid_context');jobs.get(b.ownerUserId)?.controller.abort();return {stopped:true};}
   fail('invalid_context');
 }
 const listener=(m,sender,respond)=>{
   if(m?.type!==TYPE)return;
   dispatch(m,sender).then(value=>respond({ok:true,value}),e=>respond({ok:false,error:errors.has(e?.message)?e.message:'source_error'}));return true;
 };
 return {listener,dispatch};
}
export function registerAccountWorkbench(){const controller=createAccountWorkbenchController({providerFactory:createXInteractionProviderFactory(chrome)});chrome.runtime.onMessage.addListener(controller.listener);}
