import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const code=readFileSync(new URL('../staging/interaction-interface.js',import.meta.url),'utf8');
const js=buildSync({stdin:{contents:"import {createAccountWorkbenchController} from './staging/account-workbench-background.js';import {createXInteractionProviderFactory} from './staging/interaction-provider.js';import {openInteractionDB} from './interaction-manager/storage/repository.js';import {diagnosticSummary} from './interaction-manager/sync/diagnostic.js';window.C=createAccountWorkbenchController;window.F=createXInteractionProviderFactory;window.openDB=openInteractionDB;window.diag=diagnosticSummary;window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('real provider + page projector + background sync + native IndexedDB form a dual-source chain (synthetic network)',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const r=await evaluate(`(async()=>{
   const root='chrome-extension://fixture/',state={},calls=[];let pageListener;
   const runtime={id:'fixture',getURL:p=>root+p,onMessage:{addListener:f=>pageListener=f}};
   const send=m=>new Promise(resolve=>{const async=pageListener(m,{id:'fixture',url:root+'staging/service-worker.js'},resolve);if(async!==true&&m.type!=='XRH_STAGING_WORKBENCH_IDENTITY')resolve(null)});
   const c={runtime,storage:{session:{get:async k=>({[k]:state[k]}),set:async v=>Object.assign(state,v)}},tabs:{query:async()=>[{id:1}],sendMessage:async(id,m)=>{if(id!==1)throw Error('foreign tab');return send(m)},create:async()=>({id:10}),update:async()=>({})}};
   const actor={id_str:'222',screen_name:'alice'};
   const reply={id_str:'777',user_id_str:'222',in_reply_to_user_id_str:'111',in_reply_to_status_id_str:'555',full_text:'never retained'};
   const notify={globalObjects:{notifications:{n:{icon:{id:'heart_icon'},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id:'555'}}],fromUsers:[{user:{id:'222'}}]}}}},tweets:{555:{id_str:'555',user_id_str:'111'},777:reply},users:{222:actor}},timeline:{instructions:[{addEntries:{entries:[{content:{item:{content:{tweet:{id:'777'}}}}}]}},{terminateTimeline:{direction:'Bottom'}}]}};
   const search={data:{search_by_raw_query:{search_timeline:{timeline:{instructions:[{entries:[{content:{itemContent:{__typename:'TimelineTweet',tweet_results:{result:{rest_id:'777',legacy:reply,core:{user_results:{result:{rest_id:'222',core:{screen_name:'alice'}}}}}}}}}]},{type:'TimelineTerminateTimeline',direction:'Bottom'}]}}}}};
   new Function('chrome','location','document','performance','fetch','addEventListener',${JSON.stringify(code)})(
    c,{origin:'https://x.com',pathname:'/home'},{visibilityState:'hidden',cookie:'twid=u%3D111; ct0=synthetic',querySelectorAll:()=>[{href:'https://x.com/me',getClientRects:()=>[{}],closest:()=>null}]},{getEntriesByType:()=>[]},async(url,options)=>{calls.push({path:new URL(url).pathname,method:options.method});return new Response(JSON.stringify(new URL(url).pathname.endsWith('SearchTimeline')?search:notify),{status:200})},()=>{});
   const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'actual-provider-chain'),providerFactory:F(c)});
   const side={id:'fixture',url:root+'sidepanel/sidepanel.html'},page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};
   const msg=(action,sender=page,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
   await msg('open',side);const before=await msg('view');await msg('sync',page,{authorized:true});let result;
   for(let i=0;i<700;i++){result=await msg('view');if(!result.running&&!result.busy)break;await new Promise(r=>setTimeout(r,10))}
   return {beforeRows:before.dataset.rows.length,calls,reason:result.task.reason,rows:result.dataset.rows.map(e=>({type:e.type,sources:e.sources})),jobs:result.dataset.jobs.map(j=>({source:j.source,done:j.done})),privateLeak:JSON.stringify(result).includes('never retained')||JSON.stringify(result).includes('synthetic')};
  })()`);
  assert.equal(r.beforeRows,0);assert.equal(r.reason,'source_exhausted');assert.equal(r.calls.length,2);assert.ok(r.calls.every(x=>x.method==='GET'));
  assert.deepEqual(r.rows.map(x=>x.type).sort(),['like','reply']);assert.deepEqual(r.rows.find(x=>x.type==='reply').sources,['notification','post']);
  assert.ok(r.jobs.length===2&&r.jobs.every(j=>j.done));assert.equal(r.privateLeak,false);
 });
});

test('synthetic page failure reaches persisted workbench diagnostic without leaking body or attempting post source',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
  const all=await evaluate(`(async()=>{
   const out=[];
   for(const mode of ['decode','project']){
    const root='chrome-extension://fixture/',state={},calls=[];let listener;
    const runtime={id:'fixture',getURL:p=>root+p,onMessage:{addListener:fn=>listener=fn}};
    const send=m=>new Promise(resolve=>{
     const async=listener(m,{id:'fixture',url:root+'staging/service-worker.js'},resolve);
     if(async!==true&&m.type!=='XRH_STAGING_WORKBENCH_IDENTITY')resolve(null);
    });
    const c={runtime,storage:{session:{get:async key=>({[key]:state[key]}),set:async values=>Object.assign(state,values)}},tabs:{
     query:async()=>[{id:1}],sendMessage:async(id,m)=>{if(id!==1)throw Error('foreign tab');return send(m)},
     create:async()=>({id:10}),update:async()=>({})
    }};
    const gql='https://x.com/i/api/graphql/ABCDEFGH/NotificationsTimeline?variables='+encodeURIComponent(JSON.stringify({count:20,timelineType:'All'}));
    const entries=mode==='project'?[{name:gql}]:[];
    const json=mode==='decode'?'<html>fixture-private-response</html>':JSON.stringify({data:{viewer_v2:{user_results:{result:{rest_id:'111',notification_timeline:{}}}}}});
    new Function('chrome','location','document','performance','fetch','addEventListener',${JSON.stringify(code)})(
     c,{origin:'https://x.com',pathname:'/home'},
     {visibilityState:'hidden',cookie:'twid=u%3D111; ct0=fixture-private-csrf',querySelectorAll:()=>[{href:'https://x.com/me',getClientRects:()=>[{}],closest:()=>null}]},
     {getEntriesByType:()=>entries},
     async (url,options)=>{calls.push({path:new URL(url).pathname,method:options.method});return new Response(json,{status:200})},()=>{}
    );
    const ctl=C({chromeApi:c,openDB:()=>openDB(indexedDB,'diagnostic-full-chain-'+mode),providerFactory:F(c)});
    const side={id:'fixture',url:root+'sidepanel/sidepanel.html'};
    const page={id:'fixture',url:root+'staging/interaction-workbench.html',tab:{id:10}};
    const msg=(action,sender=page,extra={})=>ctl.dispatch({type:'XRH_STAGING_ACCOUNT_WORKBENCH',feature:'interaction',action,...extra},sender);
    await msg('open',side);await msg('sync',page,{authorized:true});
    let result;
    for(let n=0;n<350;n++){
     result=await msg('view');
     if(!result.busy&&!result.running&&result.dataset)break;
     await new Promise(resolve=>setTimeout(resolve,10));
    }
    if(!result?.dataset||result.running||result.busy)throw Error('test fixture job did not settle');
    out.push({
     mode,reason:result.task.reason,diagnostic:diag(result.task),
     sources:result.task.sources.map(s=>({source:s.source,state:s.state,reason:s.reason,diagnostic:s.diagnostic??null})),
     calls,rows:result.dataset.rows.length,
     jobs:result.dataset.jobs.map(j=>({source:j.source,pages:j.pages,done:j.done})),
     leak:JSON.stringify(result).includes('fixture-private')||JSON.stringify(state).includes('fixture-private')
    });
   }
   return out;
  })()`);
  assert.equal(all.length,2);
  for(const item of all){
   const phase=item.mode==='decode'?'decode':'project',route=item.mode==='decode'?'rest':'graphql';
   assert.equal(item.reason,'schema_changed');
   assert.equal(item.rows,0);
   assert.equal(item.leak,false);
   assert.equal(item.calls.length,1,'error must never trigger post-source fetch or retry');
   assert.equal(item.calls[0].method,'GET');
   assert.deepEqual(item.jobs,[{source:'notification',pages:0,done:false}]);
   assert.equal(item.sources.length,2);
   assert.deepEqual(item.sources[0],{source:'notification',state:'stopped',reason:'schema_changed',diagnostic:{stage:'read',reason:'schema_changed',httpStatus:200,routeKind:route,readPhase:phase}});
   assert.deepEqual(item.sources[1],{source:'post',state:'pending',reason:null,diagnostic:null});
   assert.equal(item.diagnostic,'notification | read | schema_changed | HTTP 200 | '+route+' | '+phase);
  }
 });
});
