import test from "node:test";
import assert from "node:assert/strict";
import {parseRelationshipResponse,classifyResponseStatus} from "../follow-manager/v2/response-adapter.js";
import {runFixtureSync} from "../follow-manager/v2/sync-engine.js";
import {createFixtureSource} from "../follow-manager/v2/fixture-source.js";
import {FIXTURE_OWNER} from "../follow-manager/v2/fixture.js";
const owner="123",time="2026-11-26T00:00:00Z";
const user=(id,fields={})=>({entryId:"user-"+id,content:{entryType:"TimelineTimelineItem",itemContent:{itemType:"TimelineUser",user_results:{result:{__typename:"User",rest_id:id,core:{screen_name:"alice",name:"Alice"},legacy:{followers_count:22,friends_count:5},...fields}}}}});
const bottom={entryId:"cursor-bottom",content:{entryType:"TimelineTimelineCursor",cursorType:"Bottom",value:"opaque-next"}};
function input(entries,terminal=false,extra={}){
 const instructions=[{type:"TimelineAddEntries",entries}];if(terminal)instructions.push({type:"TimelineTerminateTimeline",direction:"Bottom"});
 return {ownerUserId:owner,kind:"followers",cursor:null,expected:2,observedAt:time,status:200,payload:{data:{user:{result:{__typename:"User",rest_id:owner,timeline_v2:{timeline:{instructions}}}}}},...extra};
}
test("adapter normalizes IDs and profiles; target is not viewer proof",()=>{
 const p=parseRelationshipResponse(input([user("9007199254740993123",{is_blue_verified:true}),user("99"),bottom]));
 assert.equal(p.users[0].userId,"9007199254740993123");assert.equal(p.users[0].followersCount,22);assert.equal(p.users[0].isBlueVerified,true);assert.equal(p.users[1].isBlueVerified,null);assert.equal(p.nextCursor,"opaque-next");assert.equal(p.terminal,false);assert.equal(p.coverage,"unverified_source");
 assert.throws(()=>parseRelationshipResponse(input([bottom],false,{ownerUserId:"999"})),/target_mismatch/);
});
test("explicit end only, unknown or conflicting shape fails closed",()=>{
 assert.equal(parseRelationshipResponse(input([],true)).terminal,true);
 assert.throws(()=>parseRelationshipResponse(input([])),/unknown_end/);
 assert.throws(()=>parseRelationshipResponse(input([bottom],true)),/ambiguous_terminal/);
 assert.throws(()=>parseRelationshipResponse(input([bottom,bottom])),/ambiguous_cursor/);
 assert.throws(()=>parseRelationshipResponse(input([user("3",{__typename:"UserUnavailable"}),bottom])),/unresolved_user/);
 assert.throws(()=>parseRelationshipResponse(input([user("3"),user("3",{core:{screen_name:"other"}}),bottom])),/conflicting_user/);
 assert.throws(()=>parseRelationshipResponse(input([{content:{entryType:"unknown"}},bottom])),/unknown_entry/);
});
test("access restrictions, rate limits and invalid responses stop",()=>{
 for(const [s,c] of [[401,"access_denied"],[403,"access_denied"],[429,"rate_limited"],[404,"source_unavailable"],[503,"source_error"],[201,"unexpected_status"]]){assert.equal(classifyResponseStatus(s),c);assert.throws(()=>parseRelationshipResponse(input([],true,{status:s})),new RegExp(c));}
 const bad=input([],true);bad.payload.errors=[{message:"denied"}];assert.throws(()=>parseRelationshipResponse(bad),/response_error/);
});
function mockRepo(){
 const stages={following:{cursor:null,terminal:false,count:0},followers:{cursor:null,terminal:false,count:0}};
 let job={jobId:"fixture-job",lease:"fixture-lease",source:"fixture",ownerUserId:FIXTURE_OWNER,fixtureSize:100,stages},writes=0;
 return {job,get writes(){return writes},async append(o,id,l,k,p){assert.equal(o,FIXTURE_OWNER);writes++;job={...job,stages:{...job.stages,[k]:{cursor:p.nextCursor,terminal:p.terminal,count:p.users.length}}};return job;},async pause(o,id,l,status){job={...job,status};return job;},async finalize(){return {...job,status:"completed",completeness:"complete"}}};
}
test("coordinator takes two lists through parser and atomic repository contract",async()=>{
 const repo=mockRepo();const j=await runFixtureSync({repo,job:repo.job,source:createFixtureSource(100)});assert.equal(repo.writes,2);assert.equal(j.status,"completed");
});
test("identity change after a response prevents its write; pause also prevents write",async()=>{
 const repo=mockRepo(),original=createFixtureSource(100);let changed=false;
 const source={kind:"fixture",readIdentity:async()=>({...await original.readIdentity(),sessionId:changed?"changed":"initial"}),page:async ctx=>{const p=await original.page(ctx);changed=true;return p;}};
 await assert.rejects(runFixtureSync({repo,job:repo.job,source}),/identity_changed/);assert.equal(repo.writes,0);
 const other=mockRepo(),signal=new AbortController();const aborting={...original,page:async ctx=>{const p=await original.page(ctx);signal.abort();return p;}};
 const paused=await runFixtureSync({repo:other,job:other.job,source:aborting,signal:signal.signal});assert.equal(paused.status,"paused");assert.equal(other.writes,0);
});
test("source gating refuses non-fixture and never retries rate limit",async()=>{
 const repo=mockRepo();await assert.rejects(runFixtureSync({repo,job:repo.job,source:{kind:"live"}}),/source_not_enabled/);
 const original=createFixtureSource(100);let requests=0;const source={...original,page:async()=>{requests++;throw Error("rate_limited")}};
 await assert.rejects(runFixtureSync({repo,job:repo.job,source}),/rate_limited/);assert.equal(requests,1);assert.equal(repo.writes,0);
});
