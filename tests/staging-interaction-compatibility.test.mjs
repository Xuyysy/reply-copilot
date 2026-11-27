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

test('same-page duplicated or ambiguous cursors never establish terminal coverage',()=>{
 const body=modern([notice('heart_icon')]);
 body.data.viewer_v2.user_results.result.timeline.instructions[0].entries.push({content:{cursorType:'Bottom',value:'next'}});
 assert.throws(()=>api.project(body,'graphql',owner),/ambiguous_cursor/);
 body.data.viewer_v2.user_results.result.timeline.instructions.pop();
 body.data.viewer_v2.user_results.result.timeline.instructions[0].entries.push({content:{cursorType:'Bottom',value:'other'}});
 assert.throws(()=>api.project(body,'graphql',owner),/ambiguous_cursor/);
});

test('REST operation metadata never copies credential-like query fields into an active request',()=>{
 const origin='https://x.com',endpoint=api.endpointFrom([{name:origin+'/i/api/2/notifications/all.json?count=20&include_user_entities=1&include_auth_token=fixture-sensitive&include_cookie=fixture-sensitive&include_session=fixture-sensitive'}],origin);
 const url=api.pageURL(endpoint,null,owner);
 assert.ok(!url.includes('fixture-sensitive'));assert.equal(new URL(url).searchParams.get('include_user_entities'),'1');
});
