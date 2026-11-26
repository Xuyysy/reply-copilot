import test from "node:test";
import assert from "node:assert/strict";
import {createResponseProbe,matchesRelationshipRequest} from "../follow-manager/v2/response-probe.js";
const URL="https://x.com/i/api/graphql/synthetic/Following";
const owner="123",time=Date.parse("2026-11-26T00:00:00Z");
function event(){const listeners=new Set();return {addListener:f=>listeners.add(f),removeListener:f=>listeners.delete(f),fire:x=>[...listeners].forEach(f=>f(x)),get size(){return listeners.size}};}
function harness(){const network={onRequestFinished:event(),onNavigated:event()},reports=[];let timer;const p=createResponseProbe({network,notify:x=>reports.push(x),clock:()=>time,schedule:f=>{timer=f;return 1},unschedule:()=>{timer=null}});return {network,reports,p,expire:()=>timer?.()};}
function payload(id=owner){return JSON.stringify({data:{user:{result:{__typename:"User",rest_id:id,timeline_v2:{timeline:{instructions:[{type:"TimelineAddEntries",entries:[{entryId:"user-456",content:{entryType:"TimelineTimelineItem",itemContent:{itemType:"TimelineUser",user_results:{result:{__typename:"User",rest_id:"456",core:{screen_name:"private_name"}}}}}},{entryId:"cursor-bottom",content:{entryType:"TimelineTimelineCursor",cursorType:"Bottom",value:"PRIVATE_CURSOR"}}]}]}}}}}});}
function request(url=URL,status=200,body=payload()){
 let calls=0;return {get calls(){return calls},request:{url,get headers(){throw Error("headers must never be read")},get postData(){throw Error("body must never be read")}},response:{status,content:{size:body.length},get headers(){throw Error("headers must never be read")}},getContent(cb){calls++;cb(body,"")}};
}
test("probe uses exact origin and operation; never arms without explicit authorized context",()=>{
 const h=harness();assert.equal(h.network.onRequestFinished.size,0);assert.throws(()=>h.p.start({ownerUserId:owner,kind:"following",authorized:false}),/invalid_probe_context/);
 assert.equal(matchesRelationshipRequest(URL,"following"),true);assert.equal(matchesRelationshipRequest(URL,"followers"),false);assert.equal(matchesRelationshipRequest(URL.replace("x.com","x.com.evil.test"),"following"),false);assert.equal(matchesRelationshipRequest(URL.replace("/Following","/FollowingMore"),"following"),false);
 h.p.start({ownerUserId:owner,kind:"following",authorized:true});const wrong=request(URL.replace("x.com","evil.test"));h.network.onRequestFinished.fire(wrong);assert.equal(wrong.calls,0);
 const good=request();h.network.onRequestFinished.fire(good);assert.equal(good.calls,1);assert.equal(h.p.active,false);assert.equal(h.network.onRequestFinished.size,0);assert.equal(h.network.onNavigated.size,0);
 const report=h.reports.at(-1);assert.equal(report.phase,"observed");assert.equal(report.report.parser,"accepted");assert.equal(report.report.users,1);assert.equal(report.report.coverage,"unverified_source");assert.doesNotMatch(JSON.stringify(report),/private_name|PRIVATE_CURSOR|"123"|"456"/);
 h.network.onRequestFinished.fire(good);assert.equal(good.calls,1);
});
test("mismatched target, rate limit, navigation, timeout and late callback fail closed",()=>{
 const h=harness(),start=()=>h.p.start({ownerUserId:owner,kind:"following",authorized:true});
 start();const denied=request(URL,429);h.network.onRequestFinished.fire(denied);assert.equal(denied.calls,0);assert.equal(h.reports.at(-1).reason,"rate_limited");
 start();h.network.onRequestFinished.fire(request(URL,200,payload("999")));assert.deepEqual(h.reports.at(-1),{phase:"rejected",kind:"following",reason:"target_mismatch"});
 start();let callback;const pending=request();pending.getContent=cb=>{callback=cb};h.network.onRequestFinished.fire(pending);h.network.onNavigated.fire("https://example.test");callback(payload(),"");assert.equal(h.reports.at(-1).reason,"navigation");
 start();h.expire();assert.equal(h.reports.at(-1).reason,"timeout");assert.equal(h.network.onRequestFinished.size,0);
 start();h.network.onRequestFinished.fire(request(URL,200,"not json"));assert.equal(h.reports.at(-1).reason,"invalid_json");
});
