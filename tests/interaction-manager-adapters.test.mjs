import test from 'node:test';
import assert from 'node:assert/strict';
import {parseNotificationPayload} from '../interaction-manager/adapters/notification-payload.js';
import {parsePostEvidence} from '../interaction-manager/adapters/post-evidence.js';
import {rankInteractions} from '../interaction-manager/analytics/ranking.js';
const ownerUserId='1900000000000000001',a='1900000000000000002',b='1900000000000000003',observedAt=1800000000000;
const ctx={ownerUserId,observedAt};
const user=id=>({user_results:{result:{rest_id:id}}});
const notification=(targetOwner=ownerUserId,icon='heart_icon',actors=[a,b])=>({__typename:'TimelineNotification',notification_icon:icon,timestamp_ms:'2026-10-08T17:56:12.804Z',template:{from_users:actors.map(user),target_objects:[{tweet_results:{result:{__typename:'Tweet',rest_id:'111',core:{user_results:{result:{rest_id:targetOwner}}}}}}]}});
test('grouped notification counts explicit actors only; aggregate time is unknown',()=>{
  const result=parseNotificationPayload({data:{items:[notification(),notification()]}},ctx);
  assert.equal(result.events.length,2);assert.equal(result.stats.rows,2);assert.equal(result.historyComplete,false);
  assert.ok(result.events.every(e=>e.occurredAt===null&&e.direction==='inbound'));
  assert.equal(rankInteractions(result.events,{ownerUserId,days:30,now:observedAt}).people.length,0);
});
test('foreign target, missing user ID, arbitrary text and unsupported type fail closed',()=>{
  const result=parseNotificationPayload({data:[notification(b),notification(ownerUserId,'person_icon'),notification(ownerUserId,'heart_icon',['@a']),{rich_message:{text:'a liked your post'}}]},ctx);
  assert.equal(result.events.length,0);assert.equal(result.stats.foreignTargets,1);assert.equal(result.stats.unsupported,1);assert.equal(result.stats.unresolvedActors,1);
});
test('legacy and modern overlap deduplicates, mismatched target is refused',()=>{
  const old={globalObjects:{notifications:{one:{icon:{id:'heart_icon'},template:{aggregateUserActionsV1:{targetObjects:[{tweet:{id:'111'}}],fromUsers:[{user:{id:a}}]}}}},tweets:{111:{id_str:'111',user_id_str:ownerUserId}}},data:{items:[notification(ownerUserId,'heart_icon',[a])]}};
  assert.equal(parseNotificationPayload(old,ctx).events.length,1);
  old.globalObjects.tweets[111].id_str='222';old.data={};
  assert.equal(parseNotificationPayload(old,ctx).events.length,0);
});
test('structured post evidence preserves reply and quote IDs and excludes duplicate mentions',()=>{
  const posts=[{postId:'101',authorUserId:a,replyToUserId:ownerUserId,replyToPostId:'99',mentionedUserIds:[ownerUserId],createdAt:observedAt-1000},{postId:'102',authorUserId:a,quotedUserId:ownerUserId,quotedPostId:'99'},{postId:'103',authorUserId:a,mentionedUserIds:[ownerUserId]},{postId:'104',authorUserId:b,replyToUserId:a,replyToPostId:'101'}];
  const result=parsePostEvidence(posts,ctx);
  assert.equal(result.events.length,3);assert.equal(rankInteractions(result.events,{ownerUserId,now:observedAt}).people[0].count,3);
});
