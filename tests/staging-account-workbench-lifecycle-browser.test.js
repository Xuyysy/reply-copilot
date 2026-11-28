import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:"import {createAccountWorkbenchController} from './staging/account-workbench-background.js';import {openInteractionDB} from './interaction-manager/storage/repository.js';window.C=createAccountWorkbenchController;window.openDB=openInteractionDB;window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('background task lifecycle with native checkpoints: resume, refresh, dedup and interrupted status',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
 const result=await evaluate("(async()=>{const root='chrome-extension://fixture/',state={},calls=[];const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,value:{ownerUserId:'111',handle:'me'}}),create:async()=>({id:10}),update:async()=>({})}};const factory=async()=>({id:'fixture-provider',sources:['notification','post'],identify:async()=>({ownerUserId:'111',sessionId:'stable-session'}),readPage:async({cursor,source})=>{calls.push([source,cursor]);return {status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:{data:[]},posts:[{postId:'777',authorUserId:'222',replyToUserId:'111',replyToPostId:'555',createdAt:Date.now()-5000}],users:[]}}});const opts={chromeApi:c,openDB:()=>openDB(indexedDB,'background-lifecycle'),providerFactory:factory};let ctl=C(opts);const msg=(action,sender,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};await msg('open',side);let denied=false;try{await msg('sync',page,{authorized:false})}catch{denied=true}await msg('sync',page,{authorized:true});const wait=async()=>{for(let i=0;i<200;i++){const r=await msg('view',page);if(!r.busy&&!r.running&&r.dataset)return r;await new Promise(r=>setTimeout(r,10));}throw Error('sync timeout');};const first=await wait();await msg('sync',page,{authorized:true});const second=await wait();state['xrh-interaction-task-111']={ownerUserId:'111',state:'running'};ctl=C(opts);const restarted=await msg('view',page);return {denied,calls,first:first.dataset.rows.length,firstSources:first.dataset.rows[0]?.sources,firstJobs:first.dataset.jobs.map(j=>j.source).sort(),firstReason:first.task.reason,firstOutcomes:first.task.sources,second:second.dataset.rows.length,secondSources:second.dataset.rows[0]?.sources,secondReason:second.task.reason,restarted:restarted.task.state};})()");
 assert.equal(result.denied,true);assert.deepEqual(result.calls,[['notification',null],['post',null],['notification',null],['post',null]]);assert.deepEqual(result.firstJobs,['notification','post']);assert.deepEqual(result.firstSources,['notification','post']);assert.deepEqual(result.secondSources,['notification','post']);assert.equal(result.first,1);assert.equal(result.firstReason,'source_exhausted');assert.deepEqual(result.firstOutcomes,[{source:'notification',state:'stopped',reason:'source_exhausted',pages:1,inserted:1},{source:'post',state:'stopped',reason:'source_exhausted',pages:1,inserted:0}]);assert.equal(result.second,1);assert.equal(result.secondReason,'source_exhausted');assert.equal(result.restarted,'interrupted');
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
  assert.equal(r.first,'source_exhausted');assert.equal(r.staleDenied,true);assert.equal(r.restored,'interrupted');assert.equal(r.rows,1);assert.equal(r.readsBefore,1);assert.equal(r.calls,1);assert.equal(r.otherTask,null);assert.equal(r.otherRows,0);assert.equal(r.cleared,'idle');assert.equal(r.clearedRows,0);assert.equal(r.bindingPersisted,false);assert.deepEqual(r.savedKeys,['inserted','ownerUserId','pages','reason','runId','sources','state','updatedAt']);
 });
});


test('committed progress persists during run and final cancellation wins',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const r=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',local={},session={},writes=[];let calls=0;
   const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:session[k]}),set:async v=>Object.assign(session,v)},local:{get:async k=>({[k]:local[k]}),set:async v=>{await new Promise(r=>setTimeout(r,20));Object.assign(local,v);writes.push(...Object.values(v).map(x=>[x.state,x.pages]));}}},tabs:{query:async()=>[{id:1}],sendMessage:async()=>({ok:true,value:{ownerUserId:'111',handle:'me'}}),create:async()=>({id:10}),update:async()=>({})}};
   const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'during-run-progress'),providerFactory:async()=>({id:'fixture-reader',identify:async()=>({ownerUserId:'111',sessionId:'fixture-session'}),readPage:async({source,cursor})=>{calls++;if(cursor!==null)return new Promise(()=>{});return {status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:false,nextCursor:'fixture-next',payload:{data:[]},posts:[{postId:'777',authorUserId:'222',replyToUserId:'111',replyToPostId:'555',createdAt:Date.now()-5000}]};}})});
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};
   const msg=(action,sender=page,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   const key='xrh-interaction-task-111';await msg('open',side);await msg('sync',page,{authorized:true});
   for(let i=0;i<300&&!(local[key]?.pages===1&&calls===2);i++)await new Promise(r=>setTimeout(r,10));
   const saved={...local[key]},running=await msg('view');await msg('stop');
   let final;for(let i=0;i<300;i++){final=await msg('view');if(!final.busy&&!final.running)break;await new Promise(r=>setTimeout(r,10));}
   return {saved,running:running.task,final:final.task,rows:final.dataset.rows.length,writes,calls};
  })()`);
  assert.equal(r.saved.state,'running');assert.equal(r.saved.pages,1);assert.equal(r.saved.inserted,1);assert.equal(r.running.pages,1);assert.equal(r.final.state,'stopped');assert.equal(r.final.reason,'cancelled');assert.equal(r.final.pages,1);assert.deepEqual(r.final.sources,[{source:'notification',state:'stopped',reason:'cancelled',pages:1,inserted:1}]);assert.equal(r.rows,1);assert.deepEqual(r.writes,[['running',0],['running',1],['stopped',1]]);assert.equal(r.calls,2);
 });
});

test('same owner rebinding to another tab invalidates pending task before commit',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const r=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',state={};let tab=1,release,started=false;
   const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:tab}],get:async id=>({id}),sendMessage:async()=>({ok:true,value:{ownerUserId:'111',handle:'me'}}),create:async()=>({id:10}),update:async()=>({})}};
   const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'rebound-task'),providerFactory:async()=>({id:'fixture-reader',identify:async()=>({ownerUserId:'111',sessionId:'fixture-session'}),readPage:async({source,cursor})=>{started=true;await new Promise(r=>release=r);return {status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:{data:[]},posts:[{postId:'777',authorUserId:'222',replyToUserId:'111',replyToPostId:'555',createdAt:Date.now()-5000}]};}})});
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};
   const msg=(action,sender=page,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   await msg('open',side);await msg('sync',page,{authorized:true});for(let i=0;i<300&&!started;i++)await new Promise(r=>setTimeout(r,5));if(!started)throw Error('fixture never started');tab=2;await msg('open',side);release();
   for(let i=0;i<300;i++){const v=await msg('view');if(!v.running&&!v.busy)return {reason:v.task.reason,rows:v.dataset.rows.length};await new Promise(r=>setTimeout(r,10));}throw Error('task did not stop');
  })()`);
  assert.equal(r.reason,'identity_changed');assert.equal(r.rows,0);
 });
});


test('authorized observed response commits once to native workbench database without moving live checkpoint',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const result=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',state={};let owner='111',requests=0,holdIdentity=false,releaseIdentity=null;
   const c={runtime:{id:'fixture',getURL:p=>root+p},storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async(id,m)=>{if(id!==1||m.type!=='XRH_STAGING_WORKBENCH_IDENTITY')throw Error('unexpected transport');if(holdIdentity){holdIdentity=false;await new Promise(r=>releaseIdentity=r);}return {ok:true,value:{ownerUserId:owner,handle:owner==='111'?'me':'other'}}},create:async()=>({id:10}),update:async()=>({})}};
   const factory=async()=>({id:'sample-checkpoint-test',sources:['notification'],identify:async()=>({ownerUserId:'111',sessionId:'stable-session'}),readPage:async({cursor,source})=>{requests++;return {status:200,ownerUserId:'111',source,requestCursor:cursor,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:{data:[]},posts:[{postId:'777',authorUserId:'222',replyToUserId:'111',replyToPostId:'555',createdAt:Date.now()-5000}],users:[]}}});
   const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'observed-response-commit'),providerFactory:factory});
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}},probe={id:'fixture',url:root+'staging/interaction-response-panel.html'};
   const msg=(action,sender,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   const rejects=async p=>{try{await p;return false}catch{return true}};
   await msg('open',side);await msg('sync',page,{authorized:true});
   let before;for(let i=0;i<350;i++){const v=await msg('view',page);if(!v.running&&!v.busy&&v.dataset){before=v.dataset;break;}await new Promise(r=>setTimeout(r,10))}
   if(!before)throw Error('sync did not settle');
   const start=extra=>msg('sample-start',probe,{tabId:1,source:'notification',authorized:true,...extra});
   const event={ownerUserId:'111',actorUserId:'333',targetUserId:'111',type:'like',targetPostId:'555',occurredAt:null,source:'notification',evidenceQuality:'confirmed'};
   const commit=(ticket,events=[event])=>msg('sample-commit',probe,{tabId:1,ticket,events,users:[{userId:'333',handle:'alice'}]});
   const denied=await rejects(start({authorized:false})),wrongSender=await rejects(msg('sample-start',page,{tabId:1,source:'notification',authorized:true}));
   const t1=(await start()).ticket;const overlap=await rejects(msg('sync',page,{authorized:true}));
   const first=await commit(t1);const replay=await rejects(commit(t1));
   const t2=(await start()).ticket;const duplicate=await commit(t2);
   const t3=(await start()).ticket;await msg('sample-cancel',probe,{tabId:1,ticket:t3});const cancelled=await rejects(commit(t3));
   const t4=(await start()).ticket;owner='222';const switched=await rejects(commit(t4));owner='111';
   const t5=(await start()).ticket;const foreign=await rejects(commit(t5,[{...event,ownerUserId:'222'}]));
   const t6=(await start()).ticket;holdIdentity=true;const pending=rejects(commit(t6,[{...event,targetPostId:'999'}]));
   for(let i=0;i<200&&!releaseIdentity;i++)await new Promise(r=>setTimeout(r,5));if(!releaseIdentity)throw Error('commit did not reach identity check');
   const overlapCommit=await rejects(start());await msg('sample-cancel',probe,{tabId:1,ticket:t6});releaseIdentity();const cancelledCommit=await pending;
   const after=(await msg('view',page)).dataset;
   return {denied,wrongSender,overlap,replay,cancelled,switched,foreign,first,duplicate,requests,overlapCommit,cancelledCommit,rows:after.rows.map(x=>x.type).sort(),sameJobs:JSON.stringify(before.jobs)===JSON.stringify(after.jobs),coverage:after.coverage.map(x=>({source:x.source,uniqueEvents:x.uniqueEvents,observedSamples:x.observedSamples,historyComplete:x.historyComplete}))};
  })()`);
  assert.equal(result.denied,true);assert.equal(result.wrongSender,true);assert.equal(result.overlap,true);assert.equal(result.replay,true);assert.equal(result.cancelled,true);assert.equal(result.switched,true);assert.equal(result.foreign,true);assert.equal(result.overlapCommit,true);assert.equal(result.cancelledCommit,true);
  assert.equal(result.first.inserted,1);assert.equal(result.duplicate.inserted,0);assert.equal(result.requests,1);
  assert.deepEqual(result.rows,['like','reply']);assert.equal(result.sameJobs,true);
  assert.deepEqual(result.coverage,[{source:'notification',uniqueEvents:2,observedSamples:2,historyComplete:false}]);
 });
});
