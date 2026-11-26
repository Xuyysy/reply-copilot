import {openInteractionDB,beginSession,endSession,readOwnerDataset,clearOwner} from '../interaction-manager/storage/repository.js';
import {syncInteractions} from '../interaction-manager/sync/engine.js';
import {validId} from '../interaction-manager/core/events.js';
const TYPE='XRH_STAGING_ACCOUNT_WORKBENCH';
const PATHS=Object.freeze({interaction:'staging/interaction-workbench.html',follow:'staging/follow-workbench.html'});
const idOk=v=>Number.isInteger(v)&&v>=0;
const ownerOk=v=>validId(v?.ownerUserId)&&typeof v.handle==='string'&&/^[a-z0-9_]{1,15}$/i.test(v.handle);
const same=(a,b)=>ownerOk(a)&&ownerOk(b)&&a.ownerUserId===b.ownerUserId&&a.handle.toLowerCase()===b.handle.toLowerCase();
const fail=code=>{throw Error(code)};
const errors=new Set(['owner_unverified','identity_changed','source_unavailable','busy','invalid_context','cancelled','workspace_limit']);
export function createAccountWorkbenchController({chromeApi=chrome,openDB=openInteractionDB,providerFactory=null}={}){
 const c=chromeApi,locks=new Map(),jobs=new Map();let db,dbQueue=Promise.resolve();
 const inDB=fn=>{const p=dbQueue.then(fn,fn);dbQueue=p.catch(()=>{});return p;};
 const key=f=>'xrh-workbench-'+f;
 const store=c.storage.session;
 const get=async f=>(await store.get(key(f)))[key(f)]??null;
 const put=(f,v)=>store.set({[key(f)]:v});
 const path=f=>c.runtime.getURL(PATHS[f]);
 async function identity(tabId){
   if(!idOk(tabId))fail('owner_unverified');
   const r=await c.tabs.sendMessage(tabId,{type:'XRH_STAGING_WORKBENCH_IDENTITY'});
   if(!r?.ok||!ownerOk(r.value))fail('owner_unverified');return {ownerUserId:r.value.ownerUserId,handle:r.value.handle.toLowerCase()};
 }
 async function verified(f,sender){
   const b=await get(f);if(!b||sender.tab?.id!==b.workbenchTabId||sender.url!==path(f))fail('invalid_context');
   const current=await identity(b.sourceTabId);if(!same(b,current))fail('identity_changed');
   // Re-read binding after async identity probe; a new open may have replaced it.
   const after=await get(f);if(after?.bindingId!==b.bindingId)fail('identity_changed');return b;
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
   if(jobs.has(b.ownerUserId))return {identity:{ownerUserId:b.ownerUserId,handle:b.handle},running:true,sourceReady:!!providerFactory};
   return inDB(async()=>{
   await verified(f,sender);
   if(jobs.size)fail('busy');
   db??=await openDB();
   const session=await beginSession(db,b.ownerUserId);
   try{
     await verified(f,sender);
     if(clear)await clearOwner(db,session);
     const dataset=await readOwnerDataset(db,session);
     await verified(f,sender);
     return {identity:{ownerUserId:b.ownerUserId,handle:b.handle},dataset,sourceReady:!!providerFactory,running:false};
   }finally{await endSession(db,session);}
   });
 }
 // An approved provider is a separate dependency. The shipping candidate has
 // none, and cannot start a network task. The job never depends on page lifetime.
 async function startSync(f,sender,authorized){
   const b=await verified(f,sender);
   if(f!=='interaction'||!providerFactory)fail('source_unavailable');
   if(authorized!==true)fail('invalid_context');
   if(jobs.has(b.ownerUserId))return {running:true};
   const task={controller:new AbortController()};jobs.set(b.ownerUserId,task);
   task.promise=inDB(async()=>{try{
     const provider=await providerFactory(b,{signal:task.controller.signal});
     db??=await openDB();
     task.result=await syncInteractions(db,provider,{ownerUserId:b.ownerUserId,maxPages:30,maxMs:90000,signal:task.controller.signal});
   }catch{task.result={reason:'source_unavailable'};}finally{jobs.delete(b.ownerUserId);}});
   return {running:true};
 }
 async function dispatch(m,sender){
   if(m?.type!==TYPE||sender.id!==c.runtime.id||!Object.hasOwn(PATHS,m.feature))fail('invalid_context');
   const f=m.feature;
   if(m.action==='open'){
     if(sender.url!==c.runtime.getURL('sidepanel/sidepanel.html'))fail('invalid_context');
     if(locks.has(f))return locks.get(f);
     const p=open(f);locks.set(f,p);try{return await p;}finally{locks.delete(f);}
   }
   if(m.action==='view')return read(f,sender);
   if(m.action==='identity'){const b=await verified(f,sender);return {ownerUserId:b.ownerUserId,handle:b.handle,bindingId:b.bindingId};}
   if(m.action==='clear'){if(m.confirmed!==true||f!=='interaction')fail('invalid_context');return read(f,sender,{clear:true});}
   if(m.action==='sync')return startSync(f,sender,m.authorized);
   if(m.action==='stop'){const b=await verified(f,sender);jobs.get(b.ownerUserId)?.controller.abort();return {stopped:true};}
   fail('invalid_context');
 }
 const listener=(m,sender,respond)=>{
   if(m?.type!==TYPE)return;
   dispatch(m,sender).then(value=>respond({ok:true,value}),e=>respond({ok:false,error:errors.has(e?.message)?e.message:'source_error'}));return true;
 };
 return {listener,dispatch};
}
export function registerAccountWorkbench(){const controller=createAccountWorkbenchController();chrome.runtime.onMessage.addListener(controller.listener);}
