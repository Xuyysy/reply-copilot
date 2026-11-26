import test from 'node:test';import assert from 'node:assert/strict';
import {parseImport} from '../interaction-manager/ui/import.js';
import {rankingCsv} from '../interaction-manager/ui/csv.js';
const now=1800000000000,ownerUserId='1900000000000000001',a='1900000000000000002';
test('notification participant names are extracted only from explicit identity; unknown time stays unknown',()=>{
 const raw={format:'xrh-interaction-evidence-v1',ownerUserId,kind:'notification',payload:{data:[{__typename:'TimelineNotification',notification_icon:'heart_icon',template:{from_users:[{user_results:{result:{rest_id:a,core:{screen_name:'alice'}}}}],target_objects:[{tweet_results:{result:{rest_id:'10',legacy:{user_id_str:ownerUserId}}}}]}}]},users:[{userId:'999',handle:'outside'}]};
 const r=parseImport(JSON.stringify(raw),now);assert.equal(r.events.length,1);assert.equal(r.events[0].occurredAt,null);assert.deepEqual(r.users,[{userId:a,handle:'alice',observedAt:now}]);
});
test('CSV preserves stable IDs as text and safe handle labels',()=>{
 const csv=rankingCsv([{userId:a,handle:'alice',count:1,inbound:1,outbound:0,byType:{reply:1,like:0,repost:0,quote:0,mention:0},unknownTime:0}]);
 assert.match(csv,/id:1900000000000000002/);assert.match(csv,/handle:alice/);
});
