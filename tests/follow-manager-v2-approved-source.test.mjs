import test from "node:test";
import assert from "node:assert/strict";
import {createApprovedFollowSource} from "../follow-manager/v2/approved-source.js";
import {LIVE_SOURCE} from "../follow-manager/v2/store.js";
const owner="9007199254740993123",binding={ownerUserId:owner,handle:"Zane",sessionId:"one"};
const counts={following:2,followers:1};
const user=n=>({entryId:"user-"+n,content:{entryType:"TimelineTimelineItem",itemContent:{itemType:"TimelineUser",user_results:{result:{__typename:"User",rest_id:n,core:{screen_name:"member"+n},legacy:{description:"bio",secret:"NEVER_EXPOSE"}}}}}});
function timeline(kind){
 const ids=kind==="following"?["12","13"]:["12"];
 return {data:{user:{result:{__typename:"User",rest_id:owner,timeline_v2:{timeline:{instructions:[
  {type:"TimelineAddEntries",entries:ids.map(user)},{type:"TimelineTerminateTimeline",direction:"Bottom"}
 ]}}}}}};
}
function setup(){
 let current={...binding},self={viewerUserId:owner,profileUserId:owner,handle:"Zane",counts},called=0,closed=0;
 const transport={currentBinding:async()=>current,readSelf:async()=>self,
  readPage:async({kind})=>{called++;return {status:200,payload:timeline(kind)};},close:async()=>{closed++}};
 const source=createApprovedFollowSource({binding,transport,clock:()=>"2026-11-27T00:00:00Z"});
 return {source,transport,changeBinding:b=>current=b,changeSelf:v=>self=v,get calls(){return called},get closed(){return closed}};
}
test("only verified viewer + self profile unlock a bounded own-account relationship page",async()=>{
 const h=setup();assert.equal(h.source.kind,LIVE_SOURCE);
 await assert.rejects(h.source.page({ownerUserId:owner,kind:"followers",cursor:null}),/identity_required/);
 const i=await h.source.readIdentity();assert.deepEqual(i.counts,counts);
 const page=await h.source.page({ownerUserId:owner,kind:"following",cursor:null});
 assert.equal(page.ownerUserId,owner);assert.equal(page.users.length,2);
 assert.equal(page.terminal,true);assert.equal(page.nextCursor,null);
 assert.equal(page.coverage,"authorized_observed");assert.equal(page.terminalEvidence,"explicit_or_count_confirmed");
 assert.doesNotMatch(JSON.stringify(page),/NEVER_EXPOSE/);
 assert.equal(h.calls,1);await h.source.close();assert.equal(h.closed,1);
 await assert.rejects(h.source.readIdentity(),/cancelled/);
});
test("reject conflicting viewer, changed browser session and count drift before publish",async()=>{
 const h=setup();h.changeSelf({viewerUserId:"44",profileUserId:owner,handle:"Zane",counts});
 await assert.rejects(h.source.readIdentity(),/identity_changed/);assert.equal(h.calls,0);
 const a=setup();await a.source.readIdentity();a.changeBinding({...binding,sessionId:"other"});
 await assert.rejects(a.source.page({ownerUserId:owner,kind:"followers",cursor:null}),/identity_changed/);assert.equal(a.calls,0);
 const b=setup();await b.source.readIdentity();b.changeSelf({viewerUserId:owner,profileUserId:owner,handle:"Zane",counts:{followers:2,following:2}});
 await assert.rejects(b.source.readIdentity({refresh:true}),/count_changed/);
});
test("deny wrong target, status 429 and missing explicit terminal evidence without fallback",async()=>{
 const a=setup();await a.source.readIdentity();
 await assert.rejects(a.source.page({ownerUserId:"44",kind:"followers",cursor:null}),/invalid_context/);
 a.transport.readPage=async()=>({status:429,payload:{}});
 await assert.rejects(a.source.page({ownerUserId:owner,kind:"followers",cursor:null}),/rate_limited/);
 const b=setup();await b.source.readIdentity();
 b.transport.readPage=async()=>({status:200,payload:{data:{user:{result:{__typename:"User",rest_id:owner,timeline_v2:{timeline:{instructions:[{type:"TimelineAddEntries",entries:[user("12")]}]}}}}}}});
 await assert.rejects(b.source.page({ownerUserId:owner,kind:"followers",cursor:null}),/unknown_end/);
 const c=setup();await c.source.readIdentity();
 c.transport.readPage=async()=>({status:200,payload:{data:{user:{result:{__typename:"User",rest_id:"44",timeline_v2:{timeline:{instructions:[{type:"TimelineTerminateTimeline",direction:"Bottom"}]}}}}}}});
 await assert.rejects(c.source.page({ownerUserId:owner,kind:"following",cursor:null}),/target_mismatch/);
});
test("constructor has no implicit transport or credential fallback",()=>{
 assert.throws(()=>createApprovedFollowSource({binding}),/source_unavailable/);
 assert.throws(()=>createApprovedFollowSource({binding:{...binding,sessionId:""}}),/source_unavailable/);
});
