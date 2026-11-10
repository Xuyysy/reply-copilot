import test from 'node:test';
import assert from 'node:assert/strict';
import {momentumIndex,momentumCycle,momentumInsightsModel} from '../../domain/creator-momentum-intelligence.js';
const ranges=[[500,650],[850,1100],[1350,1700]];
test('global research index is monotonic and bounded without defining any reminder triggers',()=>{
  assert.equal(momentumIndex(0,ranges).score,0);
  assert.equal(momentumIndex(100000,ranges).score,100);
  let last=0;
  for(let i=0;i<=1800;i++){const value=momentumIndex(i,ranges).score; assert.ok(value>=last&&value<=100);last=value;}
  assert.equal(momentumIndex(575,ranges).normalized,1);
  assert.equal(momentumIndex(975,ranges).normalized,2);
  assert.equal(momentumIndex(1525,ranges).normalized,3);
});
test('stage cycle resets progress after each reference crossing, not a single permanent growth bar',()=>{
  const before=momentumCycle(574,ranges),after=momentumCycle(575,ranges);
  assert.equal(before.stage,1);assert.ok(before.percent>=90);
  assert.equal(after.stage,2);assert.equal(after.percent,0);
  const secondBefore=momentumCycle(974,ranges),secondAfter=momentumCycle(975,ranges);
  assert.equal(secondBefore.stage,2);assert.ok(secondBefore.percent>=90);
  assert.equal(secondAfter.stage,3);assert.equal(secondAfter.percent,0);
  const complete=momentumCycle(1525,ranges);
  assert.equal(complete.referenceCrossings,3);assert.equal(complete.percent,100);
});
test('upper or lower bounds are not actual extension reminder confirmations',()=>{
  assert.equal(momentumCycle(500,ranges).stages[0].referenceState,'inside_reference_window');
  assert.equal(momentumCycle(650,ranges).stages[0].referenceState,'inside_reference_window');
  assert.equal(momentumCycle(651,ranges).stages[0].referenceState,'past_reference_window');
  assert.equal(momentumCycle(575,ranges).referenceCrossings,1);
  assert.ok(!('actualReminderTriggered' in momentumCycle(575,ranges)));
});
test('config edits reproject every stage and preserve hourly global and cyclical curves',()=>{
  const original=momentumInsightsModel(100,Array(24).fill(0),ranges);
  const changed=momentumInsightsModel(100,Array(24).fill(0),[[15,20],[35,40],[75,80]]);
  assert.equal(original.cycle.referenceCrossings,0);
  assert.equal(changed.cycle.referenceCrossings,3);
  assert.ok(changed.score>original.score);
  const hours=Array(24).fill(0);hours[1]=4;hours[8]=7;
  const m=momentumInsightsModel(11,hours,[[5,8],[15,20],[30,40]]);
  assert.equal(m.curve.length,24);
  assert.equal(m.curve[0].cycleProgress,0);
  assert.ok(m.curve[8].score>=m.curve[1].score);
  assert.equal(momentumInsightsModel(0,Array(24).fill(0),ranges).score,0);
});
