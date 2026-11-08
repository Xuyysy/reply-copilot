import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DEFAULT_MOMENTUM_CONFIG,validateMomentumConfig,createMomentumDay,selectMomentumReminder,recordMomentumReminder} from '../domain/creator-momentum.js';

const side=readFileSync(new URL('../sidepanel/sidepanel.js',import.meta.url),'utf8');
const admin=readFileSync(new URL('../web/src/components/admin/CreatorFeaturesPanel.tsx',import.meta.url),'utf8');
test('release candidate hides Staging-only preview and performance cards from customer sidepanel',()=>{
 assert.doesNotMatch(side,/mountMomentumTesting|mountPerformancePanel|staging\/momentum-panel|performance-panel\.js/);
 assert.match(side,/momentumControl\.refresh\(\{ensure:true\}\)/);
 assert.match(side,/remove\(PENDING_REQUEST_KEY\)/);
});
test('release candidate admin exposes deliberate low-range draft and retains server confirmation',()=>{
 for(const keyword of ['LOW_RANGES=[[1,2],[3,4],[5,6]]','momentum-low-preset','策略配置','文案管理','效果预览','版本记录','expectedVersion:published.version','validateMomentumConfig(config)'])assert.ok(admin.includes(keyword),keyword);
 assert.match(admin,/confirm\(t\('确认发布互动势能配置'/);
 assert.doesNotMatch(admin,/\/v1\/admin\/creator-momentum\/simulate/,'the admin preview does not call simulation endpoints');
});
test('low daily ACK threshold ranges trigger three distinct stages on later reply checks',()=>{
 const policy=validateMomentumConfig({...DEFAULT_MOMENTUM_CONFIG,enabled:true,ranges:[[1,2],[3,4],[5,6]],maxReminders:3});
 const time=new Date(2026,10,9,10,0,0).getTime();
 let day=createMomentumDay(time,policy,()=>.9999);
 assert.deepEqual(day.thresholds,[2,4,6]);
 const context={eligible:true,enabled:true,globalEnabled:true};
 for(const [count,stage]of [[1,null],[2,1],[3,null],[4,2],[5,null],[6,3]]){
  day={...day,count};
  assert.equal(selectMomentumReminder(day,context,time),stage,'count '+count);
  if(stage)day=recordMomentumReminder(day,stage,time);
 }
 assert.equal(selectMomentumReminder(day,context,time),null);
 assert.equal(selectMomentumReminder({...day,dnd:true,reminderCount:0},context,time),null);
 assert.equal(selectMomentumReminder({...day,reminderCount:0},{...context,eligible:false},time),null);
});
