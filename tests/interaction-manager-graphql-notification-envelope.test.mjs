import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNotificationTimelineEnvelope} from '../interaction-manager/adapters/graphql-notification-envelope.js';
import {parseNotificationPayload} from '../interaction-manager/adapters/notification-payload.js';
import {normalizePage} from '../interaction-manager/sync/engine.js';
const owner='111',actor='222',now=1800000000000;
const viewer={rest_id:owner,legacy:{id_str:owner}};
const user=id=>({rest_id:id,core:{screen_name:id===owner?'me':'other'}});
const tweet=(id,author=owner)=>({__typename:'Tweet',rest_id:id,legacy:{user_id_str:author},core:{user_results:{result:user(author)}}});
const notice=(icon='heart_icon',author=owner,who=actor)=>({__typename:'TimelineNotification',notification_icon:icon,template:{from_users:[{user_results:{result:user(who)}}],target_objects:[{tweet_results:{result:{__typename:'TweetWithVisibilityResults',tweet:tweet('555',author)}}}]}});
const entry=item=>({content:{itemContent:item}});
const result=(instructions,path='notification_timeline')=>({data:{viewer_v2:{user_results:{result:{...viewer,legacy:{...viewer.legacy},[path]:{timeline:{instructions}}}}}}});
const terminal={type:'TimelineTerminateTimeline',direction:'Bottom'};
const instructions=(items,more=false)=>[{type:'TimelineAddEntries',entries:[...items.map(entry),...(more?[{content:{cursorType:'Bottom',value:'opaque-next'}}]:[])]},...(more?[]:[terminal])];
test('raw GraphQL notification_timeline route accepts owner-bound inbound like and repost only',()=>{
 const raw=result(instructions([notice(),notice('retweet_icon'),notice('heart_icon','333')]));
 const out=inspectNotificationTimelineEnvelope(raw,{ownerUserId:owner});
 assert.equal(out.viewerVerified,true);assert.equal(out.done,true);assert.equal(out.nextCursor,null);
 const parsed=parseNotificationPayload(raw,{ownerUserId:owner,observedAt:now});
 assert.deepEqual(parsed.events.map(e=>e.type).sort(),['like','repost']);
 assert.equal(parsed.stats.foreignTargets,1);
 assert.ok(parsed.events.every(e=>e.occurredAt===null&&e.ownerUserId===owner));
 // Raw envelope is an adapter input; a provider must *separately* establish
 // structureVerified and terminal evidence before the sync engine commits.
 const page=normalizePage({status:200,ownerUserId:owner,source:'notification',requestCursor:null,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:raw},{ownerUserId:owner,source:'notification',cursor:null,observedAt:now});
 assert.equal(page.events.length,2);
});
test('previous viewer timeline and timeline_v2 variants still normalize',()=>{
 for(const path of ['timeline','timeline_v2']){
  const raw=result(instructions([notice()]),path);
  assert.equal(parseNotificationPayload(raw,{ownerUserId:owner,observedAt:now}).events.length,1);
 }
});
test('module entries, replacement entries and opaque bottom cursors do not infer history completeness',()=>{
 const raw=result([{type:'TimelineAddEntries',entries:[{content:{items:[{item:{itemContent:notice()}}]}}]},{type:'TimelineReplaceEntry',entry:entry(notice('retweet_icon'))},{type:'TimelineAddEntries',entries:[{content:{cursorType:'Bottom',value:'opaque-next'}}]}]);
 const out=inspectNotificationTimelineEnvelope(raw,{ownerUserId:owner});
 assert.deepEqual({done:out.done,nextCursor:out.nextCursor},{done:false,nextCursor:'opaque-next'});
 const parsed=parseNotificationPayload(raw,{ownerUserId:owner,observedAt:now});
 assert.equal(parsed.events.length,2);assert.equal(parsed.historyComplete,false);
});
test('viewer conflicts and malformed recognized GraphQL structures never downgrade to unknown-owner scanning',()=>{
 const conflict=result(instructions([notice()]));conflict.data.viewer_v2.user_results.result.legacy.id_str='999';
 assert.throws(()=>parseNotificationPayload(conflict,{ownerUserId:owner,observedAt:now}),/owner_mismatch/);
 // Each synthetic envelope must own its nested identity; a conflict fixture cannot taint later tests.
 assert.equal(result(instructions([notice()])).data.viewer_v2.user_results.result.legacy.id_str,owner);
 for(const variant of [
  {data:{viewer_v2:{user_results:{result:{rest_id:owner,notification_timeline:{}}}}}},
  result([]),
  result([{entries:[]}]),
  result([{type:'TimelineAddEntries',entries:[],entry:{content:{cursorType:'Bottom',value:'next'}},replaceEntry:{entry:{content:{cursorType:'Bottom',value:'other'}}}}]),
  result([...instructions([notice()]),{type:'TimelineAddEntries',entries:[{content:{cursorType:'Bottom',value:'next'}}]}]),
 ]){
  assert.throws(()=>parseNotificationPayload(variant,{ownerUserId:owner,observedAt:now}),/schema_changed|terminal_unverified|ambiguous_cursor/);
 }
});
test('unknown icon remains unsupported, foreign target remains excluded and neither becomes a confirmed interaction',()=>{
 const raw=result(instructions([notice('future_icon'),notice('heart_icon','333')]));
 const parsed=parseNotificationPayload(raw,{ownerUserId:owner,observedAt:now});
 assert.equal(parsed.events.length,0);assert.equal(parsed.stats.unsupported,1);assert.equal(parsed.stats.foreignTargets,1);
 const onlyUnknown=result(instructions([notice('future_icon')]));
 assert.throws(()=>normalizePage({status:200,ownerUserId:owner,source:'notification',requestCursor:null,structureVerified:true,done:true,nextCursor:null,terminalEvidence:'explicit',payload:onlyUnknown},{ownerUserId:owner,source:'notification',cursor:null,observedAt:now}),/schema_changed/);
});
test('projected notification arrays and legacy payloads are unaffected',()=>{
 const projected={data:[notice()]};
 assert.equal(inspectNotificationTimelineEnvelope(projected,{ownerUserId:owner}),null);
 assert.equal(parseNotificationPayload(projected,{ownerUserId:owner,observedAt:now}).events.length,1);
 const legacy={globalObjects:{notifications:{a:{icon:{id:'heart_icon'},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id:'555'}}],fromUsers:[{user:{id:actor}}]}}}},tweets:{555:{id_str:'555',user_id_str:owner}},users:{}}};
 assert.equal(parseNotificationPayload(legacy,{ownerUserId:owner,observedAt:now}).events.length,1);
});
