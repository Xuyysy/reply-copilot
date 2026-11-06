import test from 'node:test';import assert from 'node:assert/strict';
import {DEFAULT_MOMENTUM_CONFIG,validateMomentumConfig,createMomentumDay,selectMomentumReminder,recordMomentumReminder,localDayKey} from '../../domain/creator-momentum.js';
const now=new Date(2026,10,6,10).getTime();
const config={...DEFAULT_MOMENTUM_CONFIG,enabled:true};
test('daily thresholds fixed, ordered and in configured ranges; disabled/free still have counted days',()=>{
 const day=createMomentumDay(now,config,()=>0.5);assert.deepEqual(day.thresholds,[575,975,1525]);assert.equal(day.count,0);assert.equal(day.version,config.version);assert.equal(localDayKey(now),day.day);
});
test('highest eligible stage only, max daily reminders and cooldown; no UI internal thresholds',()=>{
 let day={...createMomentumDay(now,config,()=>0),count:2000};const context={eligible:true,enabled:true,globalEnabled:true};
 assert.equal(selectMomentumReminder(day,context,now),3);day=recordMomentumReminder(day,3,now);assert.equal(selectMomentumReminder(day,context,now+91*60000),null);
 let lower={...createMomentumDay(now,config,()=>0),count:600};assert.equal(selectMomentumReminder(lower,context,now),1);lower=recordMomentumReminder(lower,1,now);lower.count=1600;assert.equal(selectMomentumReminder(lower,context,now+89*60000),null);assert.equal(selectMomentumReminder(lower,context,now+90*60000),3);
});
test('free, switch OFF, pause, DND, clock rollback and expired day never remind',()=>{
 const day={...createMomentumDay(now,config,()=>0),count:1700};const base={eligible:true,enabled:true,globalEnabled:true};
 for(const patch of [{eligible:false},{enabled:false},{globalEnabled:false}])assert.equal(selectMomentumReminder(day,{...base,...patch},now),null);
 assert.equal(selectMomentumReminder({...day,dnd:true},base,now),null);assert.equal(selectMomentumReminder({...day,lastShownAt:now+1},base,now),null);assert.equal(selectMomentumReminder(day,base,now+86400000),null);
 assert.equal(selectMomentumReminder(day,base,now),3,'OFF→ON catches up once');
});
test('configuration rejects overlap, excessive reminders, weak cooldown, HTML-type data and editable paid gate',()=>{
 for(const patch of [{ranges:[[500,650],[600,1100],[1350,1700]]},{maxReminders:4},{cooldownMinutes:89},{enabled:'yes'},{paidOnly:false},{overviewZh:{html:'unsafe'}}])assert.throws(()=>validateMomentumConfig({...config,...patch}));
 assert.deepEqual(validateMomentumConfig(config).ranges,config.ranges);
});

test('daily cap and frozen day policy survive live configuration changes; global pause wins',()=>{
 const first={...config,maxReminders:1};let day={...createMomentumDay(now,first,()=>0),count:600};const ctx={eligible:true,enabled:true,globalEnabled:true};
 day=recordMomentumReminder(day,1,now);day.count=2000;assert.equal(selectMomentumReminder(day,ctx,now+91*60000),null);assert.equal(day.maxReminders,1);
 assert.deepEqual(day.thresholds,[500,850,1350]);assert.equal(selectMomentumReminder({...day,reminderCount:0},{...ctx,globalEnabled:false},now+91*60000),null);
});

test('local natural day respects timezone and DST instead of a fixed UTC or 24-hour reset',async()=>{
 const {execFileSync}=await import('node:child_process');const moduleURL=new URL('../../domain/creator-momentum.js',import.meta.url).href;
 const script=`import {localDayKey} from ${JSON.stringify(moduleURL)};console.log(JSON.stringify(['2026-11-07T00:30:00Z','2026-11-01T05:30:00Z','2026-11-01T06:30:00Z'].map(x=>localDayKey(Date.parse(x)))));`;
 const inZone=TZ=>JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ}}));
 assert.equal(inZone('UTC')[0],'2026-11-07');assert.equal(inZone('America/Los_Angeles')[0],'2026-11-06');assert.equal(inZone('Asia/Shanghai')[0],'2026-11-07');assert.deepEqual(inZone('America/New_York').slice(1),['2026-11-01','2026-11-01']);
});
