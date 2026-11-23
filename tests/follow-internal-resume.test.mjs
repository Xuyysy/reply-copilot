import test from "node:test";
import assert from "node:assert/strict";
import {MAX_INTERNAL_HANDLES,RESUME_TTL_MS,validStage,readCheckpoint,withStage,resumable}
  from "../follow-manager/internal-sync-state.js";

function stage(n=3,reason="paused",cursor="cursor-4") {
  const handles=Array.from({length:n},(_,i)=>"user_"+i);
  return {handles,ids:Object.fromEntries(handles.map((h,i)=>[h,String(i+1)])),
    verification:{user_0:true},reason,cursor,pages:14,userId:"987654321"};
}
test("30k total per kind, checkpoint per batch and strict cursor validation",()=>{
  assert.equal(MAX_INTERNAL_HANDLES,30000);
  assert.equal(validStage(stage(3000)),true);
  assert.equal(validStage(stage(30000)),true);
  assert.equal(resumable(stage(3000)),true);
  assert.equal(resumable(stage(30000)),false);
  assert.equal(validStage({...stage(),cursor:"x".repeat(513)}),false);
  assert.equal(validStage({...stage(),handles:["alice","alice"]}),false);
  assert.equal(validStage({...stage(),ids:{bad:123}}),false);
  assert.equal(validStage({...stage(),reason:"x".repeat(80)}),false);
  assert.equal(resumable(stage(10,"complete",null)),false);
});
test("resume state migrates prior v2 first-stage checkpoint and keeps stages independently",()=>{
  const now=Date.now();
  const old={owner:"owner",kind:"following",handles:["alice"],
    verification:{},ids:{},reason:"complete",savedAt:new Date(now-1000).toISOString()};
  const migrated=readCheckpoint(old,"owner",now);
  assert.deepEqual(migrated.stages.following.handles,["alice"]);
  const both=withStage(migrated,"owner","followers",stage(),new Date(now));
  assert.equal(both.stages.following.reason,"complete");
  assert.equal(both.stages.followers.cursor,"cursor-4");
  assert.equal(readCheckpoint(both,"owner",now).stages.followers.handles.length,3);
  assert.equal(readCheckpoint(both,"different",now),null);
  assert.equal(readCheckpoint({...both,savedAt:new Date(now-RESUME_TTL_MS-1).toISOString()},
    "owner",now),null);
});
test("failure does not imply completion and a resumed list retains previous handles",()=>{
  const saved=stage(3000,"rate_limited","next-after-success");
  assert.equal(resumable(saved),true);
  const checkpoint=withStage(null,"owner","following",saved);
  assert.equal(checkpoint.stages.followers,undefined);
  assert.equal(checkpoint.stages.following.handles.length,3000);
  assert.ok(readCheckpoint(checkpoint,"owner"));
});
