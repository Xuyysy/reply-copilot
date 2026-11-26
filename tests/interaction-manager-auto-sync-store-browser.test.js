import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withMomentumBrowser} from './helpers/momentum-browser.js';
const {buildSync}=createRequire(new URL('../api/package.json',import.meta.url))('esbuild');
const js=buildSync({stdin:{contents:"import {openAutoSyncStore} from './interaction-manager/sync/auto-sync-store.js';window.openAutoSyncStore=openAutoSyncStore;window.momentumReady=true;",resolveDir:process.cwd()},bundle:true,format:'iife',write:false}).outputFiles[0].text;
test('schedule store serializes cross-context claims and persists only projected local state',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
 const result=await evaluate(`(async()=>{
  const a=await openAutoSyncStore(indexedDB,'schedule-cas'),b=await openAutoSyncStore(indexedDB,'schedule-cas');
  const gate={approved:true,authorized:true,ownerUserId:'111',providerId:'approved-fixture',bindingVerified:true};
  const cfg={providerId:'approved-fixture',scheduleId:'s1',now:1000,intervalMinutes:30,gate};
  await a.configure('111',cfg);
  const results=await Promise.all([a.claim('111',{now:1801000,gate,runId:'r1'}),b.claim('111',{now:1801000,gate,runId:'r2'})]);
  const active=await b.read('111'),other=await a.read('222');
  const stopped=(await b.disable('111')).schedule;
  const late=(await a.settle('111',{scheduleId:'s1',runId:active.runId,now:1900000,reason:'source_exhausted',gate})).schedule;
  const next=(await b.configure('111',{...cfg,scheduleId:'s2',now:1900000})).schedule;
  const old=(await a.settle('111',{scheduleId:'s1',runId:active.runId,now:2000000,reason:'source_exhausted',gate})).schedule;
  a.close();b.close();
  const c=await openAutoSyncStore(indexedDB,'schedule-cas'),restored=await c.read('111');c.close();
  return {actions:results.map(r=>r.action).sort(),active,other,stopped,late,next,old,restored};
 })()`);
 assert.deepEqual(result.actions,['none','run']);assert.equal(result.active.state,'running');assert.equal(result.other,null);
 assert.equal(result.stopped.state,'disabled');assert.equal(result.late.state,'disabled');assert.equal(result.next.scheduleId,'s2');
 assert.deepEqual(result.old,result.next);assert.deepEqual(result.restored,result.next);
 assert.deepEqual(Object.keys(result.restored).sort(),['intervalMinutes','nextAt','ownerUserId','providerId','reason','runId','scheduleId','state']);
 });
});
test('schedule restart pauses an orphaned lease, rejects owner mismatch and stops denied work',{timeout:30000},async()=>{
 await withMomentumBrowser('<script>'+js+'</script>',async({evaluate})=>{
 const result=await evaluate(`(async()=>{
  const a=await openAutoSyncStore(indexedDB,'schedule-recovery');
  const gate={approved:true,authorized:true,ownerUserId:'111',providerId:'approved-fixture',bindingVerified:true};
  const cfg={providerId:'approved-fixture',scheduleId:'s1',now:1000,intervalMinutes:30,gate};
  let denied=false,busy=false;try{await a.configure('222',cfg)}catch(e){denied=e.message==='schedule_not_authorized'}
  await a.configure('111',cfg);await a.claim('111',{now:1801000,gate,runId:'r1'});
  try{await a.configure('111',{...cfg,scheduleId:'s2'})}catch(e){busy=e.message==='schedule_busy'}
  a.close();
  const b=await openAutoSyncStore(indexedDB,'schedule-recovery');
  const orphan=(await b.recover('111')).schedule,ignored=await b.claim('111',{now:9999999,gate,runId:'r2'});
  await b.configure('111',{...cfg,scheduleId:'s2',now:2000000});await b.claim('111',{now:3800000,gate,runId:'r2'});
  const limited=(await b.settle('111',{scheduleId:'s2',runId:'r2',reason:'rate_limited',now:4000000,gate})).schedule;
  b.close();return {denied,busy,orphan,ignored,limited};
 })()`);
 assert.equal(result.denied,true);assert.equal(result.busy,true);assert.equal(result.orphan.state,'paused');assert.equal(result.orphan.reason,'interrupted');
 assert.equal(result.ignored.action,'none');assert.equal(result.limited.state,'paused');assert.equal(result.limited.reason,'rate_limited');assert.equal(result.limited.nextAt,null);
 });
});
