import test from "node:test";import assert from "node:assert/strict";
import {parseRelationshipResponse} from "../follow-manager/v2/response-adapter.js";
import {inspectResponseShape} from "../follow-manager/v2/source-diagnostics.js";
const owner="9007199254740993000",id="9007199254740993001",observedAt="2026-11-26T00:00:00Z";
const u=(handle="Alice",extra={})=>({__typename:"User",rest_id:id,legacy:{screen_name:handle,followers_count:4},...extra});
const piece=result=>({itemType:"TimelineUser",user_results:{result}});
const bottom={entryId:"cursor-bottom",content:{entryType:"TimelineTimelineCursor",cursorType:"Bottom",value:"SECRET_CURSOR_42"}};
const context=entries=>({ownerUserId:owner,kind:"followers",cursor:null,expected:1,observedAt,status:200,payload:{data:{user:{result:{__typename:"User",rest_id:owner,timeline:{timeline:{instructions:[{type:"TimelineAddEntries",entries}]}}}}}}});
test("historical direct and nested user structures normalize without assuming termination",()=>{
 const direct={entryId:"user-"+id,content:{itemContent:piece(u("ALICE"))}};
 const nested={entryId:"module-item",content:{item:{itemContent:piece(u("alice"))}}};
 const p=parseRelationshipResponse(context([direct,nested,bottom]));assert.equal(p.users.length,1);assert.equal(p.users[0].userId,id);assert.equal(p.terminal,false);
 assert.throws(()=>parseRelationshipResponse(context([direct,nested])),/unknown_end/);
 const missing=context([direct,bottom]);delete missing.payload.data.user.result.rest_id;
 assert.throws(()=>parseRelationshipResponse(missing),/target_mismatch/);
});
test("explicit module shape and legacy gold/grey evidence accepted; unknown module item rejects",()=>{
 const mod={entryId:"module",content:{entryType:"TimelineTimelineModule",items:[{entryId:"item-1",item:{itemContent:piece(u("alice",{legacy:{screen_name:"alice",verified_type:"Business"},is_blue_verified:true}))}}]}};
 const p=parseRelationshipResponse(context([mod,bottom]));assert.equal(p.users[0].verificationType,"gold");assert.equal(p.users[0].isBlueVerified,false);
 mod.content.items.push({entryId:"bad",item:{itemContent:{itemType:"TimelineTweet"}}});
 assert.throws(()=>parseRelationshipResponse(context([mod,bottom])),/unknown_entry/);
});
test("shape diagnostic returns counts and enums without raw identifiers, cursor, error or profile",()=>{
 const c=context([{entryId:"user-"+id,content:{itemContent:piece(u("PRIVATE_NAME"))}},bottom]);
 const report=inspectResponseShape(c);assert.equal(report.parser,"accepted");assert.equal(report.shape.timeline,"legacy");assert.equal(report.shape.directItems,1);assert.equal(report.coverage,"unverified_source");
 const serialized=JSON.stringify(report);for(const secret of [owner,id,"PRIVATE_NAME","SECRET_CURSOR_42"])assert.equal(serialized.includes(secret),false);
 c.payload.errors=[{message:"PRIVATE_ERROR"}];const error=inspectResponseShape(c);assert.equal(error.reason,"response_error");assert.equal(JSON.stringify(error).includes("PRIVATE_ERROR"),false);
});
