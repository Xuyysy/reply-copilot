import test from 'node:test';import assert from 'node:assert/strict';
import {createScheduleClock} from '../interaction-manager/sync/schedule-clock.js';
import {enableAutoSync,claimAutoSync,stopAutoSync,recoverAutoSync} from '../interaction-manager/sync/auto-sync-policy.js';
import {createSchedulePreferences} from '../interaction-manager/sync/schedule-preferences.js';
const gate={approved:true,authorized:true,ownerUserId:'111',providerId:'approved-fixture',bindingVerified:true};
const schedule=()=>enableAutoSync({ownerUserId:'111',providerId:'approved-fixture',scheduleId:'s1',now:1000,intervalMinutes:30,gate});
function mock(){const entries=new Map(),calls=[];return {entries,calls,alarms:{get:async n=>entries.get(n),clear:async n=>{calls.push(['clear',n]);return entries.delete(n)},create:async(n,o)=>{calls.push(['create',n,o]);entries.set(n,{name:n,scheduledTime:o.when})}}};}
test('one-shot local clock restores missing alarm, ignores stale delivery and clears disabled or running schedule',async()=>{
 const m=mock(),c=createScheduleClock(m.alarms),s=schedule(),name='xrh-local-interaction-schedule:111';
 assert.deepEqual(await c.reconcile(s),{armed:true});
 assert.deepEqual(m.entries.get(name),{name,scheduledTime:s.nextAt});
 const n=m.calls.length;await c.reconcile(s);assert.equal(m.calls.length,n);
 assert.equal(c.isDue(m.entries.get(name),s,s.nextAt-1),false);
 assert.equal(c.isDue(m.entries.get(name),s,s.nextAt),true);
 assert.equal(c.isDue({name,scheduledTime:s.nextAt-1},s,s.nextAt),false);
 assert.equal(c.isDue({name:'other',scheduledTime:s.nextAt},s,s.nextAt),false);
 m.entries.clear();await c.reconcile(s);assert.ok(m.entries.has(name));
 const r=claimAutoSync(s,{now:s.nextAt,gate,runId:'r1'}).schedule;
 assert.deepEqual(await c.reconcile(r),{armed:false});assert.equal(m.entries.has(name),false);
 await c.reconcile(recoverAutoSync(r));await c.reconcile(stopAutoSync(s));assert.equal(m.entries.size,0);
});
test('interval preferences persist only interval and never approve or enable',async()=>{
 const values={},storage={get:async k=>({[k]:values[k]}),set:async v=>Object.assign(values,v)};
 const p=createSchedulePreferences(storage);assert.equal((await p.read('111')).intervalMinutes,60);
 assert.deepEqual(await p.write('111',120),{intervalMinutes:120,enabled:false,reason:'source_unverified'});
 assert.deepEqual(values,{'xrh-interaction-interval-111':120});assert.equal((await p.read('222')).intervalMinutes,60);
 await assert.rejects(p.write('111',31),/invalid_interval/);await assert.rejects(p.read('invalid'),/invalid_owner/);
});
