import test from 'node:test';
import assert from 'node:assert/strict';
import {enableAutoSync,claimAutoSync,settleAutoSync,stopAutoSync,recoverAutoSync} from '../interaction-manager/sync/auto-sync-policy.js';
const gate={approved:true,authorized:true,ownerUserId:'111',providerId:'approved-fixture',bindingVerified:true};
const start=()=>enableAutoSync({ownerUserId:'111',providerId:'approved-fixture',scheduleId:'s1',intervalMinutes:30,now:1000,gate});
const due=()=>claimAutoSync(start(),{now:1801000,gate,runId:'r1'}).schedule;
test('schedule requires explicit consent and an approved verified matching provider',()=>{
 for(const change of [{approved:false},{authorized:false},{bindingVerified:false},{ownerUserId:'222'},{providerId:'other'}])assert.throws(()=>enableAutoSync({ownerUserId:'111',providerId:'approved-fixture',scheduleId:'s1',now:1000,gate:{...gate,...change}}),/schedule_not_authorized/);
 for(const intervalMinutes of [1,0,-1,Infinity])assert.throws(()=>enableAutoSync({ownerUserId:'111',providerId:'approved-fixture',scheduleId:'s1',now:1000,gate,intervalMinutes}),/invalid_schedule/);
});
test('only a due idle task can claim a lease; no duplicate or catch-up run',()=>{
 const s=start();assert.equal(claimAutoSync(s,{now:1800999,gate,runId:'r1'}).action,'none');
 assert.equal(claimAutoSync(s,{now:1801000,gate,busy:true,runId:'r1'}).action,'none');
 const r=due();assert.equal(r.state,'running');assert.equal(claimAutoSync(r,{now:9000000,gate,runId:'r2'}).action,'none');
 const after=settleAutoSync(r,{scheduleId:'s1',runId:'r1',reason:'page_limit',now:9000000,gate});assert.equal(after.nextAt,10800000);assert.equal(after.state,'waiting');
 assert.equal(claimAutoSync(after,{now:9000000,gate,runId:'r2'}).action,'none');
});
test('authorization changes, errors and interrupted runs pause without retries',()=>{
 const r=due();for(const reason of ['rate_limited','forbidden','unauthenticated','schema_changed','time_limit','cancelled','unexpected']){
 const s=settleAutoSync(r,{scheduleId:'s1',runId:'r1',reason,now:2000000,gate});assert.equal(s.state,'paused');assert.equal(s.nextAt,null);assert.equal(claimAutoSync(s,{now:9000000,gate,runId:'r2'}).action,'none');}
 assert.equal(claimAutoSync(start(),{now:1801000,gate:{...gate,approved:false},runId:'r1'}).schedule.reason,'authorization_changed');
 assert.equal(recoverAutoSync(r).reason,'interrupted');assert.equal(recoverAutoSync(start()).state,'waiting');
});
test('stale completion cannot resume a stopped or replaced schedule',()=>{
 const r=due(),stopped=stopAutoSync(r);assert.equal(settleAutoSync(stopped,{scheduleId:'s1',runId:'r1',reason:'source_exhausted',now:2000000,gate}).state,'disabled');
 assert.equal(settleAutoSync(r,{scheduleId:'s2',runId:'r1',reason:'source_exhausted',now:2000000,gate}),r);
 assert.equal(settleAutoSync(r,{scheduleId:'s1',runId:'r2',reason:'source_exhausted',now:2000000,gate}),r);
 assert.equal(settleAutoSync(r,{scheduleId:'s1',runId:'r1',reason:'source_exhausted',now:2000000,gate:{...gate,ownerUserId:'222'}}).reason,'authorization_changed');
});
