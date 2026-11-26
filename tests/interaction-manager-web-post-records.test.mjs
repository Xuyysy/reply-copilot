import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeWebPostRecords} from '../interaction-manager/adapters/web-post-records.js';
import {normalizePage} from '../interaction-manager/sync/engine.js';
import {rankInteractions} from '../interaction-manager/analytics/ranking.js';
const ownerUserId='1900000000000000001',actor='1900000000000000002',other='1900000000000000003',observedAt=1800000000000;
const record=(id,author,legacy={},extra={})=>({__typename:'Tweet',rest_id:id,core:{user_results:{result:{rest_id:author,core:{screen_name:author===actor?'alice':'owner'}}}},legacy:{id_str:id,user_id_str:author,created_at:'Wed Oct 08 12:00:00 +0000 2025',...legacy},...extra});
const wrap=tweet=>({__typename:'TweetWithVisibilityResults',tweet});
const target=record('111',ownerUserId);
const repost=record('112',actor,{retweeted_status_result:{result:wrap(target)},entities:{user_mentions:[{id_str:ownerUserId}]}});
const page={status:200,ownerUserId,source:'notification',requestCursor:null,done:true,nextCursor:null,terminalEvidence:'explicit',structureVerified:true,payload:{data:[]}};
const context={ownerUserId,source:'notification',cursor:null,observedAt};
test('structured repost fills actual time without counting original text mentions',()=>{
 const r=decodeWebPostRecords([wrap(repost)],{observedAt});
 assert.equal(r.posts.length,1);assert.equal(r.posts[0].repostedUserId,ownerUserId);assert.equal(r.posts[0].mentionedUserIds,undefined);
 const v=normalizePage({...page,webPosts:[repost]},context);
 assert.equal(v.events.length,1);assert.equal(v.events[0].type,'repost');assert.equal(v.events[0].occurredAt,Date.UTC(2025,9,8,12));
 assert.equal(v.users[0].handle,'alice');
});
test('notification repost and structured post repost are one relation, timestamp comes from post',()=>{
 const n={__typename:'TimelineNotification',notification_icon:'retweet_icon',template:{from_users:[{user_results:{result:{rest_id:actor}}}],target_objects:[{tweet_results:{result:target}}]}};
 const v=normalizePage({...page,payload:{data:[n]},webPosts:[repost]},context);
 assert.equal(v.events.length,1);assert.equal(v.events[0].occurredAt,Date.UTC(2025,9,8,12));
 assert.equal(rankInteractions(v.events,{ownerUserId,now:observedAt}).people[0].count,1);
});
test('reject stubs, conflicting IDs, mismatched targets and unrelated posts',()=>{
 const bad=record('123',actor,{user_id_str:other});
 assert.throws(()=>decodeWebPostRecords([bad,{__typename:'Tweet',rest_id:'123'}],{observedAt}),/schema_changed/);
 assert.throws(()=>decodeWebPostRecords([record('124',actor,{retweeted_status_id_str:'999',retweeted_status_result:{result:target}})],{observedAt}),/schema_changed/);
 const v=normalizePage({...page,webPosts:[record('125',actor,{in_reply_to_user_id_str:other,in_reply_to_status_id_str:'999'}),bad]},context);
 assert.equal(v.events.length,0);assert.equal(v.quality.ignored,1);
});
test('quoted wrapper, duplicate implicit mention, invalid timestamp and explicit participants',()=>{
 const quote=record('126',actor,{created_at:'not a date',quoted_status_id_str:'111',entities:{user_mentions:[{id_str:ownerUserId}]}},{quoted_status_result:{result:wrap(target)}});
 const v=normalizePage({...page,source:'post',webPosts:[quote]},{...context,source:'post'});
 assert.equal(v.events.length,1);assert.equal(v.events[0].type,'quote');assert.equal(v.events[0].occurredAt,null);assert.equal(v.users[0].userId,actor);
});
