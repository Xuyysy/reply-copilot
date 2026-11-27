import test from "node:test";
import assert from "node:assert/strict";
import {createApprovedFollowRunner} from "../follow-manager/v2/approved-runner.js";
import {LIVE_SOURCE} from "../follow-manager/v2/store.js";
const b={ownerUserId:"9007199254740993123",handle:"Zane",sessionId:"session-1"};
const counts={following:2,followers:2};
function setup(){
 let opened=0,closed=0,starts=0,resumes=0,run=null,job=null,readCount=0,viewerId=b.ownerUserId;
 const transport={currentBinding:async()=>b,readSelf:async()=>{readCount++;return {viewerUserId:viewerId,profileUserId:b.ownerUserId,handle:b.handle,counts}},readPage:async()=>{throw Error("not_called")},close:async()=>{closed++}};
 const repo={active:async()=>job,start:async(o,src,cts)=>{assert.equal(src,LIVE_SOURCE);assert.deepEqual(cts,counts);starts++;return {ownerUserId:o,jobId:"job",lease:"lease",expectedCounts:counts,source:LIVE_SOURCE,status:"syncing"}},resume:async(o,id,lease)=>{resumes++;return {...job,lease:"new",status:"syncing"}},close:()=>{}};
 let work=async({job,source,signal})=>{assert.equal(source.kind,LIVE_SOURCE);run=signal;return {...job,status:"completed"}};
 const runner=()=>createApprovedFollowRunner({openTransport:async()=>{opened++;return transport},openRepo:async()=>repo,sync:args=>work(args)});
 return {runner,repo,transport,setWork:f=>work=f,setJob:j=>job=j,setViewerId:x=>viewerId=x,
  get opened(){return opened},get closed(){return closed},get starts(){return starts},get resumes(){return resumes},get run(){return run},get reads(){return readCount}};
}
test("runner denies unapproved or absent transports before any stored/network work",async()=>{
 const h=setup(),r=h.runner();
 assert.throws(()=>r.start({binding:b}),/access_denied/);
 assert.equal(h.opened,0);
 assert.throws(()=>createApprovedFollowRunner().start({binding:b,authorized:true}),/source_unavailable/);
 assert.throws(()=>r.start({binding:{...b,sessionId:""},authorized:true}),/identity_changed/);
 assert.equal(h.opened,0);
});
test("one task per controller; independent self profile; no duplicate start; closed source",async()=>{
 const h=setup(),r=h.runner();
 let release;h.setWork(async({job,source,signal})=>{
  assert.equal(source.kind,LIVE_SOURCE);
  await new Promise(resolve=>release=resolve);
  return {...job,status:"completed"};
 });
 assert.deepEqual(r.start({binding:b,authorized:true}),{accepted:true,running:true});
 assert.deepEqual(r.start({binding:b,authorized:true}),{accepted:false,running:true});
 assert.throws(()=>r.start({binding:{...b,ownerUserId:"22"},authorized:true}),/identity_changed/);
 for(let n=0;n<200&&!release;n++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(r.status(b).running,true);release();await r.waitForIdle();
 assert.equal(r.status(b).status,"completed");assert.equal(h.starts,1);assert.equal(h.closed,1);
});
test("resumes previously committed source-owned checkpoint without resetting existing rows",async()=>{
 const h=setup();h.setJob({ownerUserId:b.ownerUserId,jobId:"job",lease:"old",source:LIVE_SOURCE,expectedCounts:counts,status:"paused"});
 const r=h.runner();r.start({binding:b,authorized:true});await r.waitForIdle();
 assert.equal(h.resumes,1);assert.equal(h.starts,0);assert.equal(r.status(b).status,"completed");
});
test("count drift and conflicting viewer fail before job creation, closing the source",async()=>{
 const h=setup();h.setViewerId("999");
 const r=h.runner();r.start({binding:b,authorized:true});await r.waitForIdle();
 assert.equal(r.status(b).status,"identity_changed");assert.equal(h.starts,0);assert.equal(h.closed,1);
 const x=setup();x.setJob({ownerUserId:b.ownerUserId,jobId:"job",lease:"old",source:LIVE_SOURCE,expectedCounts:{following:3,followers:2},status:"paused"});
 const rr=x.runner();rr.start({binding:b,authorized:true});await rr.waitForIdle();
 assert.equal(rr.status(b).status,"count_changed");assert.equal(x.resumes,0);
});
test("close view does not cancel; explicit stop aborts and still closes; session switching fences task",async()=>{
 const h=setup(),r=h.runner();
 h.setWork(async({job,signal})=>{await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener("abort",resolve,{once:true})});return {...job,status:"paused"}});
 r.start({binding:b,authorized:true});
 for(let n=0;n<200&&!h.starts;n++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(r.status(b).running,true);
 assert.throws(()=>r.stop({...b,sessionId:"different"}),/identity_changed/);
 assert.equal(r.stop(b).stopping,true);await r.waitForIdle();
 assert.equal(h.closed,1);assert.equal(r.status(b).status,"paused");
 const x=setup(),rx=x.runner();
 x.setWork(async({job,signal})=>{await new Promise(resolve=>{if(signal.aborted)resolve();else signal.addEventListener("abort",resolve,{once:true})});return {...job,status:"paused"}});
 rx.start({binding:b,authorized:true});
 for(let n=0;n<200&&!x.starts;n++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(rx.status({...b,sessionId:"changed"}).status,"identity_changed");await rx.waitForIdle();
});
