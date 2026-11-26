import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeEvent} from '../interaction-manager/core/events.js';
import {analyzeLiveDataset,interactionDetails} from '../interaction-manager/analytics/live-view.js';
import {rankingCsv} from '../interaction-manager/ui/csv.js';
const now=1800000000000,owner='111',actor='222';
const row=(type,id,time=null,other=actor)=>normalizeEvent({ownerUserId:owner,actorUserId:other,targetUserId:owner,type,eventPostId:type==='reply'||type==='mention'?id:null,targetPostId:'555',occurredAt:time,observedAt:now,source:'notification',evidenceQuality:'confirmed'},owner);
const dataset={ownerUserId:owner,rows:[row('like','555'),row('reply','777',now-1000),row('mention','777',now-1000),row('reply','888',now-40*86400000,'333')],users:[{ownerUserId:owner,userId:actor,handle:'Alice'},{ownerUserId:'999',userId:'333',handle:'Wrong'}],coverage:[],jobs:[]};
test('live filters agree with detail and CSV; unknown dates and redundant mentions are excluded',()=>{
 const all=analyzeLiveDataset(dataset,{now});assert.equal(all.people[0].count,2);assert.equal(all.people[1].handle,null);
 const recent=analyzeLiveDataset(dataset,{now,days:7,query:'@alice'});assert.equal(recent.people.length,1);assert.equal(recent.people[0].count,1);assert.equal(recent.excludedUnknownTime,1);
 assert.equal(interactionDetails(dataset,actor,{now,days:7}).length,1);
 assert.equal(analyzeLiveDataset(dataset,{now,type:'mention'}).people.length,0);
 assert.match(rankingCsv(recent.people),/"id:222","handle:Alice"/);
});
test('ranking does not discard users beyond a top-100 presentation limit',()=>{
 const rows=Array.from({length:180},(_,i)=>row('like','555',null,String(1000+i)));
 const v=analyzeLiveDataset({...dataset,rows},{now});assert.equal(v.people.length,180);assert.equal(v.totalPeople,180);
});
