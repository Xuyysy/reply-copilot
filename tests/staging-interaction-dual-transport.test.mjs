import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID,webcrypto} from 'node:crypto';
const code=readFileSync(new URL('../staging/interaction-interface.js',import.meta.url),'utf8');
const terminal={type:'TimelineTerminateTimeline',direction:'Bottom'};
const user={rest_id:'222',core:{screen_name:'alice'}};
const reply={rest_id:'777',core:{user_results:{result:user}},legacy:{in_reply_to_user_id_str:'111',in_reply_to_status_id_str:'555',full_text:'do not retain'}};
const search=(cursor=null)=>({data:{search_by_raw_query:{search_timeline:{timeline:{instructions:[{entries:[{content:{itemContent:{__typename:'TimelineTweet',tweet_results:{result:reply}}}},...(cursor?[{content:{cursorType:'Bottom',value:cursor}}]:[])]},...(!cursor?[terminal]:[])]}}}}});
function fixture({status=200,body=search(),changed=false,header={},pathname='/home',hang=false,timeoutFast=false,entries=[],digest=null}={}){
 let listener;const calls=[],events={};
 const doc={visibilityState:'hidden',cookie:'twid=u%3D111; ct0=fixture-csrf',querySelectorAll:()=>[{href:'https://x.com/me',getClientRects:()=>[{}],closest:()=>null}]};
 const c={URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,Uint8Array,Set,Map,Promise,JSON,Date,Error,Object,Array,Number,String,RegExp,decodeURIComponent,setTimeout:(fn,ms)=>setTimeout(fn,timeoutFast&&ms===12000?10:ms),clearTimeout,crypto:{randomUUID,subtle:digest?{digest}:webcrypto.subtle},location:{origin:'https://x.com',pathname},document:doc,performance:{getEntriesByType:()=>entries},addEventListener:(t,f)=>events[t]=f,chrome:{runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onMessage:{addListener:fn=>listener=fn}}},fetch:async(url,options)=>{calls.push({url,options});if(hang)return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{const e=Error('fixture');e.name='AbortError';reject(e)},{once:true}));if(changed)doc.cookie='twid=u%3D333; ct0=other';return new Response(JSON.stringify(body),{status,headers:header});}};
 vm.runInNewContext(code,c);
 const sender={id:'test',url:'chrome-extension://test/staging/service-worker.js'};
 const send=(action,extra={},from=sender)=>new Promise(resolve=>{if(listener({type:'XRH_STAGING_INTERACTION_INTERFACE',action,...extra},from,resolve)!==true)resolve(null)});
 return {send,calls,events};
}
const start=(f,connectionId='11111111-1111-4111-8111-111111111111')=>f.send('start',{authorized:true,background:true,connectionId});
test('background handshake from hidden bound X tab exposes dual-source direct reads without passive capture',async()=>{
 const f=fixture(),s=await start(f);assert.equal(s.ok,true);assert.deepEqual(Array.from(s.value.sources),['notification','post']);
 const p=await f.send('page',{sessionId:s.value.sessionId,ownerUserId:'111',source:'post',cursor:null});
 assert.equal(p.ok,true);assert.equal(p.value.source,'post');assert.equal(p.value.posts[0].replyToUserId,'111');assert.equal(p.value.done,true);assert.equal(p.value.viewerVerified,false);
 assert.ok(!JSON.stringify(p).includes('do not retain'));assert.ok(!JSON.stringify(p).includes('fixture-csrf'));
 const r=f.calls[0];assert.equal(r.options.method,'GET');assert.equal(r.options.credentials,'same-origin');assert.equal(r.options.redirect,'error');
 const u=new URL(r.url);assert.equal(u.origin,'https://x.com');assert.ok(u.pathname.endsWith('/SearchTimeline'));assert.equal(JSON.parse(u.searchParams.get('variables')).product,'Latest');
});
test('direct notifications endpoint requires no page observation or navigation',async()=>{
 const body={globalObjects:{notifications:{},tweets:{},users:{}},timeline:{instructions:[{terminateTimeline:{direction:'Bottom'}}]}};
 const f=fixture({body}),s=(await start(f)).value;
 const p=await f.send('page',{sessionId:s.sessionId,ownerUserId:'111',source:'notification',cursor:null});
 assert.equal(p.ok,true);assert.equal(p.value.done,true);assert.equal(new URL(f.calls[0].url).pathname,'/i/api/2/notifications/all.json');
});
test('post cursors forwarded exactly; unknown schemas, ambiguous terminals and foreign targets fail closed',async()=>{
 const f=fixture({body:search('opaque-next')}),s=(await start(f)).value;
 const p=await f.send('page',{sessionId:s.sessionId,ownerUserId:'111',source:'post',cursor:'prior'});
 assert.equal(p.value.nextCursor,'opaque-next');assert.equal(JSON.parse(new URL(f.calls[0].url).searchParams.get('variables')).cursor,'prior');
 for(const body of [{data:{}}, {errors:[{message:'never expose'}]},search('same')]){
  const x=fixture({body}),i=(await start(x)).value;
  const r=await x.send('page',{sessionId:i.sessionId,ownerUserId:'111',source:'post',cursor:'same'});
  assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes('never expose'));
 }
 const foreign=structuredClone(search());foreign.data.search_by_raw_query.search_timeline.timeline.instructions[0].entries[0].content.itemContent.tweet_results.result.legacy.in_reply_to_user_id_str='333';
 const x=fixture({body:foreign}),i=(await start(x)).value;
 assert.equal((await x.send('page',{sessionId:i.sessionId,ownerUserId:'111',source:'post',cursor:null})).value.posts.length,0);
});
test('unauthorized sources, owners, senders and navigation cannot access or continue session',async()=>{
 const f=fixture();assert.equal(await f.send('start',{authorized:true,background:true},{id:'test',url:'https://x.com/'}),null);
 assert.equal((await f.send('start',{background:true,authorized:false})).ok,false);
 const i=(await start(f)).value;
 for(const args of [{source:'following',ownerUserId:'111'},{source:'post',ownerUserId:'222'}])assert.equal((await f.send('page',{sessionId:i.sessionId,cursor:null,...args})).ok,false);
 assert.equal(f.calls.length,0);f.events.pagehide();assert.equal((await f.send('identity',{sessionId:i.sessionId})).ok,false);
});
test('account change and 401/403/429 stop without retries; rate cooldown survives a new session',async()=>{
 const changed=fixture({changed:true}),i=(await start(changed)).value;
 assert.equal((await changed.send('page',{sessionId:i.sessionId,ownerUserId:'111',source:'post',cursor:null})).error,'identity_changed');
 for(const status of [401,403,429]){
  const f=fixture({status,header:{'retry-after':'120'}}),s=(await start(f)).value;
  assert.equal((await f.send('page',{sessionId:s.sessionId,ownerUserId:'111',source:'post',cursor:null})).value.status,status);
  assert.equal((await f.send('page',{sessionId:s.sessionId,ownerUserId:'111',source:'post',cursor:null})).ok,false);
  if(status===429){const n=(await start(f)).value;assert.equal((await f.send('page',{sessionId:n.sessionId,ownerUserId:'111',source:'post',cursor:null})).error,'rate_limited');}
  assert.equal(f.calls.length,1);
 }
});

test('request timeout differs from explicit cancellation and never triggers a retry',async()=>{
 const f=fixture({hang:true,timeoutFast:true}),s=(await start(f)).value;
 assert.equal((await f.send('page',{sessionId:s.sessionId,ownerUserId:'111',source:'post',cursor:null})).error,'time_limit');
 assert.equal(f.calls.length,1);
 const g=fixture({hang:true}),i=(await start(g)).value;
 const pending=g.send('page',{sessionId:i.sessionId,ownerUserId:'111',source:'post',cursor:null});
 g.events.pagehide();assert.equal((await pending).error,'cancelled');assert.equal(g.calls.length,1);
});

test('checkpoint provider identity changes with transport, not random session or observed user query',async()=>{
 const a=await start(fixture()),b=await start(fixture());
 assert.match(a.value.providerId,/^x-web-[a-f0-9]{32}$/);assert.equal(a.value.providerId,b.value.providerId);
 const gql='https://x.com/i/api/graphql/ABCDEFGH/NotificationsTimeline?variables='+encodeURIComponent(JSON.stringify({count:20,timelineType:'All'}));
 const modern=await start(fixture({entries:[{name:gql}]}));assert.notEqual(a.value.providerId,modern.value.providerId);
});

test('cancellation or replacement during fingerprint cannot resurrect a late page session',async()=>{
 for(const replace of [false,true]){
  let release,count=0;
  const f=fixture({digest:(...args)=>++count===1?new Promise(resolve=>{release=()=>webcrypto.subtle.digest(...args).then(resolve)}):webcrypto.subtle.digest(...args)});
  const old=start(f);assert.equal(typeof release,'function');
  let next;
  if(replace)next=await start(f,'22222222-2222-4222-8222-222222222222');
  else await f.send('cancel',{connectionId:'11111111-1111-4111-8111-111111111111'});
  await release();assert.equal((await old).error,'cancelled');
  if(replace){
   await f.send('cancel',{connectionId:'11111111-1111-4111-8111-111111111111'});
   assert.equal((await f.send('identity',{sessionId:next.value.sessionId})).ok,true);
  }else assert.equal((await f.send('identity',{sessionId:'cancelled-session'})).ok,false);
  assert.equal(f.calls.length,0);
 }
});
