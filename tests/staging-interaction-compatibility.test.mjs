// Synthetic compatibility cases. These are NOT captured live X responses.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../staging/interaction-interface.js';
import {normalizePage} from '../interaction-manager/sync/engine.js';
const api=globalThis.ReplyCopilotInteractionInterface,owner='111',now=Date.now();
const user=id=>({rest_id:id,core:{screen_name:id===owner?'owner':'actor'}});
const tweet=(id,author=owner,extra={})=>({__typename:'Tweet',rest_id:id,core:{user_results:{result:user(author)}},legacy:{user_id_str:author,...extra}});
const notice=icon=>({__typename:'TimelineNotification',notification_icon:icon,template:{from_users:[{user_results:{result:user('222')}}],target_objects:[{tweet_results:{result:tweet('555')}}]}});
const item=value=>({content:{itemContent:value}});
const terminal={type:'TimelineTerminateTimeline',direction:'Bottom'};
const modern=items=>({data:{viewer_v2:{user_results:{result:{rest_id:owner,timeline:{instructions:[{entries:items.map(item)},terminal]}}}}}});
const postBody=posts=>({data:{search_by_raw_query:{search_timeline:{timeline:{instructions:[{entries:posts.map(p=>item({__typename:'TimelineTweet',tweet_results:{result:p}}))},terminal]}}}}});
const normalized=(body,kind,source)=>normalizePage({status:200,ownerUserId:owner,source,requestCursor:null,...api.project(body,kind,owner)},{ownerUserId:owner,source,cursor:null,observedAt:now});
const legacy=icon=>({globalObjects:{notifications:{n:{icon:{id:icon},template:{aggregateUserActionsV1:{fromUsers:[{user:{id:'222'}}],targetObjects:[{tweet:{id:'555'}}]}}}},tweets:{555:{id_str:'555',user_id_str:owner}},users:{222:{id_str:'222',screen_name:'actor'}}},timeline:{instructions:[{terminateTimeline:{direction:'Bottom'}}]}});

test('synthetic end-to-end projection matrix covers five distinct explicit relationships with no prose inference',()=>{
 const n=normalized(modern([notice('heart_icon'),notice('retweet_icon')]),'graphql','notification');
 assert.deepEqual(n.events.map(e=>e.type).sort(),['like','repost']);assert.ok(n.events.every(e=>e.occurredAt===null));
 const posts=[tweet('777','222',{in_reply_to_user_id_str:owner,in_reply_to_status_id_str:'555'}),{...tweet('778','222'),quoted_status_result:{result:tweet('556')}},tweet('779','222',{entities:{user_mentions:[{id_str:owner}]}}),tweet('780','222',{full_text:'@owner inferred prose must not count'}),tweet('781','222',{in_reply_to_user_id_str:'333',in_reply_to_status_id_str:'557'})];
 const p=normalized(postBody(posts),'search','post');assert.deepEqual(p.events.map(e=>e.type).sort(),['mention','quote','reply']);
 assert.ok([...n.events,...p.events].every(e=>e.ownerUserId===owner&&e.targetUserId===owner&&e.actorUserId==='222'));
 for(const [icon,type] of [['heart_icon','like'],['retweet_icon','repost']])assert.deepEqual(normalized(legacy(icon),'rest','notification').events.map(e=>e.type),[type]);
});

test('raw-page projector preserves validated out-of-scope notices rather than hiding them before normalization',()=>{
 const person=notice('person_icon');person.template.target_objects=[];
 const p=normalized(modern([person]),'graphql','notification');assert.equal(p.events.length,0);assert.equal(p.stats.outOfScope,1);assert.equal(p.quality.ignored,1);
 const old=legacy('person_icon');old.globalObjects.notifications.n.template.aggregateUserActionsV1.targetObjects=[];
 const o=normalized(old,'rest','notification');assert.equal(o.events.length,0);assert.equal(o.stats.outOfScope,1);
});

test('unknown notification schemas stop at the actual source projector, including mixed supported pages',()=>{
 for(const items of [[notice('unknown_future_icon')],[notice('heart_icon'),notice('unknown_future_icon')]])assert.throws(()=>api.project(modern(items),'graphql',owner),/schema_changed/);
 assert.throws(()=>api.project(legacy('unknown_future_icon'),'rest',owner),/schema_changed/);
 for(const kind of ['graphql','rest']){
  const body=kind==='graphql'?modern([notice('person_icon')]):legacy('person_icon');
  assert.throws(()=>api.project(body,kind,owner),/schema_changed/,'follow icon with a target post is not a validated follow notice');
 }
});

test('contradictory explicit viewer identities cannot be downgraded to unverified and ingested',()=>{
 const body=modern([notice('heart_icon')]);body.data.viewer_v2.user_results.result.legacy={id_str:'333'};
 assert.throws(()=>api.project(body,'graphql',owner),/owner_mismatch/);
});


test('duplicated GraphQL viewer aliases cannot conceal a contradictory owner identity',()=>{
 const body=modern([notice('heart_icon')]);
 body.data.viewer={user_results:{result:{rest_id:'333',legacy:{id_str:'333'}}}};
 assert.throws(()=>api.project(body,'graphql',owner),/owner_mismatch/);
 const alias=body.data.viewer.user_results.result;
 alias.rest_id=owner;alias.legacy.id_str=owner;
 assert.deepEqual(normalized(body,'graphql','notification').events.map(e=>e.type),['like']);
 alias.legacy.id_str='333';
 assert.throws(()=>api.project(body,'graphql',owner),/owner_mismatch/);
});

test('same-page duplicated or ambiguous cursors never establish terminal coverage',()=>{
 const body=modern([notice('heart_icon')]);
 body.data.viewer_v2.user_results.result.timeline.instructions[0].entries.push({content:{cursorType:'Bottom',value:'next'}});
 assert.throws(()=>api.project(body,'graphql',owner),/ambiguous_cursor/);
 body.data.viewer_v2.user_results.result.timeline.instructions.pop();
 body.data.viewer_v2.user_results.result.timeline.instructions[0].entries.push({content:{cursorType:'Bottom',value:'other'}});
 assert.throws(()=>api.project(body,'graphql',owner),/ambiguous_cursor/);
});


test('Staging projector accepts notification_timeline without changing legacy GraphQL wrappers',()=>{
 for(const path of ['notification_timeline','timeline','timeline_v2']){
  const body=modern([notice('heart_icon'),notice('retweet_icon')]);
  const viewer=body.data.viewer_v2.user_results.result;
  if(path==='timeline_v2'){viewer.timeline_v2={timeline:viewer.timeline};delete viewer.timeline;}
  else if(path==='notification_timeline'){viewer.notification_timeline=viewer.timeline;delete viewer.timeline;}
  const out=normalized(body,'graphql','notification');
  assert.deepEqual(out.events.map(x=>x.type).sort(),['like','repost']);
  assert.equal(out.done,true);
  assert.ok(out.events.every(x=>x.occurredAt===null));
 }
});
test('notification_timeline modules and replacement entries project through normalization',()=>{
 const body=modern([]),viewer=body.data.viewer_v2.user_results.result;
 viewer.notification_timeline=viewer.timeline;delete viewer.timeline;
 const follow=notice('person_icon');follow.template.target_objects=[];
 viewer.notification_timeline.instructions=[
  {type:'TimelineAddEntries',entries:[{content:{items:[{item:{itemContent:notice('heart_icon')}},{item:{content:{itemContent:follow}}}]}}]},
  {type:'TimelineReplaceEntry',replaceEntry:{entry:item(notice('retweet_icon'))}},
  {type:'TimelineAddEntries',entries:[{content:{cursorType:'Bottom',value:'opaque-next'}}]}
 ];
 const projected=api.project(body,'graphql',owner);
 assert.equal(projected.nextCursor,'opaque-next');assert.equal(projected.done,false);
 const out=normalized(body,'graphql','notification');
 assert.deepEqual(out.events.map(x=>x.type).sort(),['like','repost']);
 assert.equal(out.stats.outOfScope,1);
 assert.equal(out.historyComplete,false);
});
test('notification_timeline unknown nested icons and malformed wrappers still fail closed',()=>{
 const body=modern([]),viewer=body.data.viewer_v2.user_results.result;
 viewer.notification_timeline=viewer.timeline;delete viewer.timeline;
 viewer.notification_timeline.instructions=[{type:'TimelineAddEntries',entries:[{content:{items:[{item:{itemContent:notice('future_icon')}}]}}]},terminal];
 assert.throws(()=>api.project(body,'graphql',owner),/schema_changed/);
 viewer.notification_timeline={};
 assert.throws(()=>api.project(body,'graphql',owner),/schema_changed/);
 viewer.notification_timeline={timeline:{instructions:[{type:'TimelineAddEntries',addEntries:{entries:{wrong:'type'}}}]}};
 assert.throws(()=>api.project(body,'graphql',owner),/schema_changed/);
});


test('REST target omissions and contradictory tweet identities reject the full page',()=>{
 for(const mutate of [
  b=>{delete b.globalObjects.tweets['555'];},
  b=>{b.globalObjects.notifications.n.template.aggregateUserActionsV1.targetObjects=[{tweet:{id:'999'}}];},
  b=>{b.globalObjects.tweets['555'].id_str='999';},
  b=>{delete b.globalObjects.tweets['555'].user_id_str;},
  b=>{b.globalObjects.tweets['555']=null;}
 ]){
  const body=legacy('heart_icon');mutate(body);
  assert.throws(()=>api.project(body,'rest',owner),/schema_changed/);
 }
 const mixed=legacy('heart_icon');
 mixed.globalObjects.notifications.broken={icon:{id:'retweet_icon'},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id:'999'}}],fromUsers:[{user:{id:'222'}}]}}};
 assert.throws(()=>api.project(mixed,'rest',owner),/schema_changed/);
 const foreign=legacy('heart_icon');foreign.globalObjects.tweets['555'].user_id_str='333';
 const parsed=normalized(foreign,'rest','notification');
 assert.equal(parsed.events.length,0);assert.equal(parsed.quality.foreignTargets,1);
});


test('known like/repost aggregates reject missing or conflicting actors and target evidence',()=>{
 for(const icon of ['heart_icon','retweet_icon']){
  for(const mutate of [
   n=>{n.template.from_users=[];},
   n=>{n.template.from_users.push({user_results:{result:{rest_id:'333',legacy:{id_str:'444'}}}});},
   n=>{n.template.from_users=[{user_results:{result:{core:{screen_name:'missing-id'}}}}];},
   n=>{n.template.target_objects=[{tweet_results:{result:null}}];}
  ]){
   const valid=notice(icon),body=modern([valid]);
   mutate(valid);
   assert.throws(()=>api.project(body,'graphql',owner),/schema_changed/);
  }
  const good=notice(icon),bad=notice(icon);
  bad.template.from_users.push({user_results:{result:{rest_id:'999',legacy:{id_str:'888'}}}});
  assert.throws(()=>api.project(modern([good,bad]),'graphql',owner),/schema_changed/,'a good aggregate cannot conceal a corrupt one');
  for(const mutate of [
   row=>{row.template.aggregateUserActionsV1.fromUsers=[];},
   row=>{row.template.aggregateUserActionsV1.fromUsers.push({user:{id:'222',id_str:'333'}});},
   row=>{row.template.aggregateUserActionsV1.fromUsers.push({user:{id:null}});}
  ]){
   const body=legacy(icon);mutate(body.globalObjects.notifications.n);
   assert.throws(()=>api.project(body,'rest',owner),/schema_changed/);
  }
 }
 // A missing display handle is not a missing explicit actor ID.
 const valid=legacy('heart_icon');delete valid.globalObjects.users['222'];
 assert.deepEqual(normalized(valid,'rest','notification').events.map(e=>e.type),['like']);
});

test('nested module fanout has an aggregate limit even when every entry meets its local limit',()=>{
 const body=modern([]),viewer=body.data.viewer_v2.user_results.result;
 // Each item is a known non-countable kind, and each module stays below 100.
 const module={content:{items:Array.from({length:100},()=>({item:{itemContent:{__typename:'TimelineSkip'}}}))}};
 viewer.timeline.instructions=[{type:'TimelineAddEntries',entries:Array.from({length:50},()=>module)},terminal];
 const within=api.project(body,'graphql',owner);
 assert.equal(within.done,true);assert.equal(within.ignored,5000);
 viewer.timeline.instructions[0].entries.push(module);
 assert.throws(()=>api.project(body,'graphql',owner),/page_limit/);
 // A small, real relationship still survives a module-wrapped page.
 viewer.timeline.instructions=[{type:'TimelineAddEntries',entries:[{content:{items:[{item:{itemContent:notice('heart_icon')}}]}}]},terminal];
 assert.deepEqual(normalized(body,'graphql','notification').events.map(e=>e.type),['like']);
});


test('recognized non-like notification icons do not block confirmed likes or invent other events',()=>{
 const known=['reply_icon','mention_icon','at_icon','quote_icon','bell_icon','bird_icon','community_icon','list_icon','space_icon','microphone_icon'];
 for(const kind of ['graphql','rest'])for(const icon of known){
  if(kind==='graphql'){
   const out=normalized(modern([notice('heart_icon'),notice(icon)]),'graphql','notification');
   assert.deepEqual(out.events.map(e=>e.type),['like']);assert.equal(out.quality.ignored,1);assert.equal(out.done,true);
  }else{
   const body=legacy('heart_icon');
   body.globalObjects.notifications.other={icon:{id:icon},template:{aggregateUserActionsV1:{fromUsers:[{user:{id:'222'}}],targetObjects:[]}}};
   const out=normalized(body,'rest','notification');
   assert.deepEqual(out.events.map(e=>e.type),['like']);assert.equal(out.quality.ignored,1);
  }
 }
 assert.throws(()=>api.project(modern([notice('heart_icon'),notice('unclassified_icon')]),'graphql',owner),/schema_changed/);
});


test('REST URT cursor-bottom operation and displayed notification references are accepted',()=>{
 const body=legacy('heart_icon');
 body.globalObjects.notifications.hidden={icon:{id:'future-icon'}};
 body.timeline.instructions=[{type:'TimelineAddEntries',addEntries:{entries:[
  {entryId:'cursor-top-42',content:{operation:{cursor:{value:'ignored-top'}}}},
  {entryId:'notification-n',content:{}},
  {entryId:'cursor-bottom-41',content:{operation:{cursor:{value:'opaque-rest-next'}}}}
 ]}}];
 const p=api.project(body,'rest',owner);
 assert.equal(p.nextCursor,'opaque-rest-next');assert.equal(p.done,false);
 const result=normalized(body,'rest','notification');
 assert.deepEqual(result.events.map(e=>e.type),['like']);
 assert.equal(result.nextCursor,'opaque-rest-next');assert.equal(result.done,false);
 body.timeline.instructions[0].addEntries.entries[2]={entryId:'cursor-bottom',content:{value:'plain-bottom'}};
 assert.equal(api.project(body,'rest',owner).nextCursor,'plain-bottom');
});
test('REST URT rejects missing/mismatched bottom values and missing referenced notifications',()=>{
 const make=()=>{const b=legacy('heart_icon');b.timeline.instructions=[{addEntries:{entries:[
  {entryId:'notification-n',content:{}},
  {entryId:'cursor-bottom-10',content:{operation:{cursor:{value:'opaque'}}}}
 ]}}];return b;};
 for(const mutate of [
  b=>{b.timeline.instructions[0].addEntries.entries[1].content={};},
  b=>{b.timeline.instructions[0].addEntries.entries[1].content={cursorType:'Top',value:'opaque'};},
  b=>{b.timeline.instructions[0].addEntries.entries[1].content={value:'different',operation:{cursor:{value:'opaque'}}};}
 ]){const b=make();mutate(b);assert.throws(()=>api.project(b,'rest',owner),/(invalid_pagination|ambiguous_cursor)/);}
 const missing=make();missing.timeline.instructions[0].addEntries.entries[0].entryId='notification-not-present';
 assert.throws(()=>api.project(missing,'rest',owner),/schema_changed/);
 const both=make();both.timeline.instructions[0].addEntries.entries.push({entryId:'cursor-bottom-11',content:{operation:{cursor:{value:'other'}}}});
 assert.throws(()=>api.project(both,'rest',owner),/ambiguous_cursor/);
 const noProof=make();noProof.timeline.instructions[0].addEntries.entries.pop();
 assert.throws(()=>api.project(noProof,'rest',owner),/terminal_unverified/);
 const terminal=make();terminal.timeline.instructions.push({type:'TimelineTerminateTimeline',direction:'Bottom'});
 assert.throws(()=>api.project(terminal,'rest',owner),/ambiguous_cursor/);
});

test('REST operation metadata never copies credential-like query fields into an active request',()=>{
 const origin='https://x.com',endpoint=api.endpointFrom([{name:origin+'/i/api/2/notifications/all.json?count=20&include_user_entities=1&include_auth_token=fixture-sensitive&include_cookie=fixture-sensitive&include_session=fixture-sensitive'}],origin);
 const url=api.pageURL(endpoint,null,owner);
 assert.ok(!url.includes('fixture-sensitive'));assert.equal(new URL(url).searchParams.get('include_user_entities'),'1');
});
