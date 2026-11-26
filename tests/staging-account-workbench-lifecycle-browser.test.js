import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:"import {createAccountWorkbenchController} from './staging/account-workbench-background.js';import {openInteractionDB} from './interaction-manager/storage/repository.js';window.C=createAccountWorkbenchController;window.openDB=openInteractionDB;window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('background task lifecycle with native checkpoints: resume, refresh, dedup and interrupted status',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
 const result=await evaluate("(async()=>{const root='chrome-extension://fixture/',state={},calls=[];const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,value:{ownerUserId:'111',handle:'me'}}),create:async()=>({id:10}),update:async()=>({})}};const factory=async()=>({id:'fixture-provider',sources:['notification','post'],identify:async()=>({ownerUserId:'111',sessionId:'stable-session'}),readPage:async({cursor,source})=>{calls.push([source,cursor]);return {status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:{data:[]},posts:[{postId:'777',authorUserId:'222',replyToUserId:'111',replyToPostId:'555',createdAt:Date.now()-5000}],users:[]}}});const opts={chromeApi:c,openDB:()=>openDB(indexedDB,'background-lifecycle'),providerFactory:factory};let ctl=C(opts);const msg=(action,sender,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};await msg('open',side);let denied=false;try{await msg('sync',page,{authorized:false})}catch{denied=true}await msg('sync',page,{authorized:true});const wait=async()=>{for(let i=0;i<200;i++){const r=await msg('view',page);if(!r.busy&&!r.running&&r.dataset)return r;await new Promise(r=>setTimeout(r,10));}throw Error('sync timeout');};const first=await wait();await msg('sync',page,{authorized:true});const second=await wait();state['xrh-interaction-task-111']={ownerUserId:'111',state:'running'};ctl=C(opts);const restarted=await msg('view',page);return {denied,calls,first:first.dataset.rows.length,firstSources:first.dataset.rows[0]?.sources,firstJobs:first.dataset.jobs.map(j=>j.source).sort(),firstReason:first.task.reason,second:second.dataset.rows.length,secondSources:second.dataset.rows[0]?.sources,secondReason:second.task.reason,restarted:restarted.task.state};})()");
 assert.equal(result.denied,true);assert.deepEqual(result.calls,[['notification',null],['post',null],['notification',null],['post',null]]);assert.deepEqual(result.firstJobs,['notification','post']);assert.deepEqual(result.firstSources,['notification','post']);assert.deepEqual(result.secondSources,['notification','post']);assert.equal(result.first,1);assert.equal(result.firstReason,'source_exhausted');assert.equal(result.second,1);assert.equal(result.secondReason,'source_exhausted');assert.equal(result.restarted,'interrupted');
 });
});

test('cancelled factory cannot block a later dual-source sync; provider closes after committed pages',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const r=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',state={};let attempts=0,closed=0;
   const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,value:{ownerUserId:'111',handle:'me'}}),create:async()=>({id:10}),update:async()=>({})}};
   const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'provider-cancellation'),providerFactory:async()=>{attempts++;if(attempts===1)return new Promise(()=>{});return {id:'authorized-reader-v1',sources:['notification','post'],identify:async()=>({ownerUserId:'111',sessionId:'session'}),readPage:async({source,cursor})=>({status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:{data:[]},posts:[]}),close:async()=>closed++}}});
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};
   const msg=(action,sender=page,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   await msg('open',side);await msg('sync',page,{authorized:true});
   while(!attempts)await new Promise(r=>setTimeout(r,5));await msg('stop');
   const wait=async()=>{for(let i=0;i<200;i++){const r=await msg('view');if(!r.running&&!r.busy)return r;await new Promise(r=>setTimeout(r,5))}throw Error('slot remained occupied')};
   const stopped=await wait();await msg('sync',page,{authorized:true});const success=await wait();
   return {attempts,closed,stopped:stopped.task.reason,reason:success.task.reason,jobs:success.dataset.jobs.map(j=>j.source).sort()};
  })()`);
  assert.equal(r.attempts,2);assert.equal(r.closed,1);assert.equal(r.stopped,'cancelled');assert.equal(r.reason,'source_exhausted');assert.deepEqual(r.jobs,['notification','post']);
 });
});


test('bounded dual-source scans advance both partial checkpoints and preserve partial status',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const r=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',state={},calls=[];
   const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,value:{ownerUserId:'111',handle:'me'}}),create:async()=>({id:10}),update:async()=>({})}};
   const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'source-fairness'),providerFactory:async()=>({id:'test-reader',sources:['notification','post'],identify:async()=>({ownerUserId:'111',sessionId:'session'}),readPage:async({source,cursor})=>{calls.push(source);return {status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:source==='post',nextCursor:source==='post'?null:String(Number(cursor??0)+1),terminalEvidence:source==='post'?'explicit':null,payload:{data:[]},posts:[]}}})});
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};
   const msg=(action,sender=page,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   const run=async()=>{await msg('sync',page,{authorized:true});for(let i=0;i<300;i++){const r=await msg('view');if(!r.running&&!r.busy)return r;await new Promise(r=>setTimeout(r,5))}throw Error('not done')};
   await msg('open',side);const first=await run(),second=await run();return {calls,firstReason:first.task.reason,secondReason:second.task.reason,jobs:second.dataset.jobs.map(j=>({source:j.source,pages:j.pages,done:j.done}))};
  })()`);
  assert.equal(r.firstReason,'page_limit');assert.equal(r.secondReason,'page_limit');
  assert.equal(r.calls.filter(s=>s==='notification').length,30);assert.equal(r.calls.filter(s=>s==='post').length,2);
  assert.deepEqual(r.jobs.map(j=>j.source).sort(),['notification','post']);assert.equal(r.jobs.find(j=>j.source==='post').done,true);
 });
});


test('task summary survives browser session loss; new binding required and cached progress is retained',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const r=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',local={},session={};let calls=0,owner='111',serial=10;
   const area=s=>({get:async k=>({[k]:s[k]}),set:async v=>Object.assign(s,v)});
   const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:area(session),local:area(local)},tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,value:{ownerUserId:owner,handle:'me'}}),create:async()=>({id:++serial}),update:async()=>({})}};
   const factory=async()=>({id:'fixture-progress',identify:async()=>({ownerUserId:owner,sessionId:'fixture-session'}),readPage:async({source,cursor})=>{calls++;return {status:200,ownerUserId:owner,source,requestCursor:cursor,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:{data:[]},posts:[{postId:'777',authorUserId:'222',replyToUserId:owner,replyToPostId:'555'}]}}});
   const opts={chromeApi:c,openDB:()=>openDB(indexedDB,'persistent-task-summary'),providerFactory:factory};let ctl=C(opts);
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'};const page=id=>({id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id}});
   const msg=(action,sender,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   const wait=async p=>{for(let i=0;i<200;i++){const v=await msg('view',p);if(!v.running&&!v.busy)return v;await new Promise(r=>setTimeout(r,5))}throw Error('sync timeout')};
   await msg('open',side);await msg('sync',page(11),{authorized:true});const first=await wait(page(11));
   const key='xrh-interaction-task-111',saved=local[key];local[key]={...saved,state:'running',reason:null};
   for(const k of Object.keys(session))delete session[k];ctl=C(opts);
   let staleDenied=false;try{await msg('view',page(11))}catch{staleDenied=true}
   await msg('open',side);const restored=await msg('view',page(12));const readsBefore=calls;
   owner='333';await msg('open',side);const other=await msg('view',page(13));
   owner='111';await msg('open',side);const cleared=await msg('clear',page(14),{confirmed:true});
   return {staleDenied,savedKeys:Object.keys(saved).sort(),bindingPersisted:Object.keys(local).some(k=>k.startsWith('xrh-workbench-')),first:first.task.reason,restored:restored.task.state,rows:restored.dataset.rows.length,readsBefore,calls,otherTask:other.task,otherRows:other.dataset.rows.length,cleared:cleared.task.state,clearedRows:cleared.dataset.rows.length};
  })()`);
  assert.equal(r.first,'source_exhausted');assert.equal(r.staleDenied,true);assert.equal(r.restored,'interrupted');assert.equal(r.rows,1);assert.equal(r.readsBefore,1);assert.equal(r.calls,1);assert.equal(r.otherTask,null);assert.equal(r.otherRows,0);assert.equal(r.cleared,'idle');assert.equal(r.clearedRows,0);assert.equal(r.bindingPersisted,false);assert.deepEqual(r.savedKeys,['inserted','ownerUserId','pages','reason','runId','state','updatedAt']);
 });
});
