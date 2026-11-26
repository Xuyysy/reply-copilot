import test from "node:test";
import assert from "node:assert/strict";
import {runAuthorizedSync} from "../follow-manager/v2/authorized-sync.js";
import {LIVE_SOURCE} from "../follow-manager/v2/store.js";
const owner="123",counts={following:2,followers:2},sessionId="session-a";
function harness(){
 let job={ownerUserId:owner,jobId:"j",lease:"l",source:LIVE_SOURCE,expectedCounts:counts,stages:{following:{cursor:null,terminal:false},followers:{cursor:null,terminal:false}}},writes=0,finals=0;
 const repo={async append(o,id,l,k,p){writes++;job={...job,stages:{...job.stages,[k]:{cursor:p.nextCursor,terminal:p.terminal}}};return job;},async pause(o,id,l,status){job={...job,status};return job;},async finalize(o,id,l,finalCounts){assert.deepEqual(finalCounts,counts);finals++;return {...job,status:"completed"};}};
 const source={kind:LIVE_SOURCE,readIdentity:async()=>({source:LIVE_SOURCE,ownerUserId:owner,sessionId,counts,identityEvidence:"self_profile_and_session"}),page:async({kind,cursor})=>({ownerUserId:owner,kind,cursor,expected:counts[kind],coverage:"authorized_observed",terminal:true,terminalEvidence:"explicit_or_count_confirmed",nextCursor:null,users:[{userId:"2"},{userId:"3"}]})};
 return {repo,job,source,get writes(){return writes},get finals(){return finals}};
}
test("authorized provider requires stable identity and counts, completes both lists",async()=>{const h=harness();const j=await runAuthorizedSync(h);assert.equal(j.status,"completed");assert.equal(h.writes,2);assert.equal(h.finals,1);});
test("authorized provider fences account changes before write and count changes before publication",async()=>{
 const h=harness();let count=0;const read=h.source.readIdentity;h.source.readIdentity=async()=>({...await read(),sessionId:++count>=3?"changed":sessionId});await assert.rejects(runAuthorizedSync(h),/identity_changed/);assert.equal(h.writes,0);
 const h2=harness();const original=h2.source.readIdentity;h2.source.readIdentity=async opts=>({...await original(),counts:opts?.refresh?{following:3,followers:2}:counts});await assert.rejects(runAuthorizedSync(h2),/count_changed/);assert.equal(h2.writes,2);assert.equal(h2.finals,0);
});
test("no automatic retry on rate limit and page budget is resumable",async()=>{
 const h=harness();let attempts=0;h.source.page=async()=>{attempts++;throw Error("rate_limited")};await assert.rejects(runAuthorizedSync(h),/rate_limited/);assert.equal(attempts,1);assert.equal(h.writes,0);
 const h2=harness();const j=await runAuthorizedSync({...h2,maxPages:1});assert.equal(j.status,"paused");assert.equal(h2.writes,1);assert.equal(h2.finals,0);
});
