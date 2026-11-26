import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent,mergeEvent,validId,primaryEvents} from '../interaction-manager/core/events.js';
import {rankInteractions} from '../interaction-manager/analytics/ranking.js';
const me='1900000000000000001',other='1900000000000000002',third='1900000000000000003',now=1800000000000,day=86400000;
const raw=(over={})=>({ownerUserId:me,actorUserId:other,targetUserId:me,type:'reply',eventPostId:'123',targetPostId:'456',occurredAt:now-day,observedAt:now,source:'notification',evidenceQuality:'confirmed',...over});
const ev=(over={})=>normalizeEvent(raw(over),me);
test('snowflake identity stays string; reject owner mismatch, self and unknown evidence',()=>{
  assert.equal(validId(me),true);assert.equal(validId(Number(me)),false);
  for(const input of [raw({ownerUserId:third}),raw({actorUserId:me}),raw({targetUserId:third}),raw({evidenceQuality:'observed'}),raw({actorUserId:'@alice'}),raw({occurredAt:now+1}),raw({eventPostId:null}),raw({direction:'outbound'})])assert.equal(normalizeEvent(input,me),null);
});
test('cross-source duplicate merges and distinct replies to the same target stay distinct',()=>{
  const a=ev(),b=ev({source:'post'}),c=ev({eventPostId:'124'});
  assert.equal(a.eventId,b.eventId);assert.notEqual(a.eventId,c.eventId);
  assert.deepEqual(mergeEvent(a,b).sources,['notification','post']);
  assert.equal(rankInteractions([a,b,c],{ownerUserId:me,now}).people[0].count,2);
});
test('likes count unique actor/post relations; conflicting time remains unknown',()=>{
  const a=ev({type:'like',eventPostId:null}),b=ev({type:'like',eventPostId:'999',occurredAt:now-day*2});
  const merged=mergeEvent(a,b);assert.equal(merged.occurredAt,null);assert.equal(merged.timeConflict,true);
  assert.equal(mergeEvent(merged,a).occurredAt,null);
  const result=rankInteractions([a,b],{ownerUserId:me,days:7,now});
  assert.equal(result.people.length,0);assert.equal(result.excludedUnknownTime,1);
  assert.equal(rankInteractions([a,b],{ownerUserId:me,now}).people[0].count,1);
});
test('mention already represented by reply is not a second interaction',()=>{
  assert.equal(primaryEvents([ev(),ev({type:'mention'})]).length,1);
  assert.equal(primaryEvents([ev(),ev({type:'mention',eventPostId:'555'})]).length,2);
});
test('directions and date windows, unknown timestamps, deterministic sorting',()=>{
  const rows=[ev(),ev({actorUserId:third,eventPostId:'777',occurredAt:null}),ev({actorUserId:me,targetUserId:other,eventPostId:'888'}),ev({eventPostId:'999',occurredAt:now-day*40})];
  assert.equal(rankInteractions(rows,{ownerUserId:me,days:7,now}).people[0].count,1);
  assert.equal(rankInteractions(rows,{ownerUserId:me,direction:'outbound',now}).people[0].count,1);
  const all=rankInteractions(rows,{ownerUserId:me,direction:'both',now});
  assert.equal(all.people[0].count,3);assert.equal(all.people[0].inbound,2);assert.equal(all.people[0].outbound,1);assert.equal(all.people[1].unknownTime,1);
  assert.equal(rankInteractions(rows,{ownerUserId:third,now}).people.length,0);
});
test('event-level time decay never boosts an old event because of a recent event',()=>{
  const old=ev({occurredAt:now-day*14}),fresh=ev({eventPostId:'124',occurredAt:now});
  assert.equal(rankInteractions([old,fresh],{ownerUserId:me,now,sort:'recent',halfLife:14}).people[0].recent,4.5);
});
