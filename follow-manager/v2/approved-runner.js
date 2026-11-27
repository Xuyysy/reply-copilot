// Own-account Follow task runner: identity -> approved source -> local
// transaction -> bounded pages -> retained snapshot. No network implementation,
// credential access, polling, alarms, or UI lifecycle dependency is included.
import {stableId} from "./model.js";
import {LIVE_SOURCE,openRepository} from "./store.js";
import {createApprovedFollowSource} from "./approved-source.js";
import {runAuthorizedSync} from "./authorized-sync.js";

const HANDLE=/^[A-Za-z0-9_]{1,15}$/;
const CODES=new Set(["source_unavailable","identity_changed","invalid_count","count_changed",
 "rate_limited","access_denied","cancelled","time_limit","source_page_mismatch",
 "unexpected_status","response_error","target_mismatch","unknown_timeline",
 "unknown_instruction","ambiguous_terminal","page_capacity","unknown_entry",
 "ambiguous_cursor","unresolved_user","user_entry_mismatch","conflicting_user",
 "unknown_end","cursor_loop","stale_page","no_new_users","capacity","stale_job",
 "job_exists","job_requires_discard","unfinished","database_blocked"]);
const safeError=e=>CODES.has(e?.message)?e.message:"sync_failed";
const validBinding=b=>stableId(b?.ownerUserId)&&HANDLE.test(b?.handle??"")&&typeof b.sessionId==="string"&&b.sessionId.length>0&&b.sessionId.length<=128;
const same=(a,b)=>a?.ownerUserId===b?.ownerUserId&&a?.sessionId===b?.sessionId&&
 a?.handle?.toLowerCase()===b?.handle?.toLowerCase();
const expectedSame=(a,b)=>["following","followers"].every(k=>a?.[k]===b?.[k]);

// This runner deliberately requires a transport supplied by reviewed code.
// It does not make an X transport out of an extension page message, cookies,
// observed routes, or parameters supplied by an end user.
export function createApprovedFollowRunner({
 openTransport=null,
 openRepo=()=>openRepository(indexedDB,{live:true}),
 sync=runAuthorizedSync,
 maxPages=60,maxMs=240000
}={}){
 if(!Number.isInteger(maxPages)||maxPages<1||maxPages>120||
 !Number.isInteger(maxMs)||maxMs<1||maxMs>240000||
 typeof openRepo!=="function"||typeof sync!=="function")throw Error("invalid_context");
 let running=null,last=null;
 async function execute(task){
  let transport=null,source=null,repo=null;
  try{
   transport=await openTransport({binding:task.binding,signal:task.controller.signal});
   if(task.controller.signal.aborted)throw Error("cancelled");
   source=createApprovedFollowSource({binding:task.binding,transport});
   const verified=await source.readIdentity({signal:task.controller.signal});
   if(task.controller.signal.aborted)throw Error("cancelled");
   repo=await openRepo();
   if(task.controller.signal.aborted)throw Error("cancelled");
   let job=await repo.active(verified.ownerUserId);
   if(task.controller.signal.aborted)throw Error("cancelled");
   if(job){
    if(job.ownerUserId!==verified.ownerUserId||job.source!==LIVE_SOURCE)throw Error("source_page_mismatch");
    if(!["paused","syncing","interrupted"].includes(job.status))throw Error("job_requires_discard");
    if(!expectedSame(job.expectedCounts,verified.counts))throw Error("count_changed");
    job=await repo.resume(job.ownerUserId,job.jobId,job.lease);
   }else job=await repo.start(verified.ownerUserId,LIVE_SOURCE,verified.counts);
   // Capture this source's independently verified local binding around
   // every request; runAuthorizedSync also checks response ID/expected counts
   // and re-reads the self profile before finalizing.
   const guarded={
    kind:LIVE_SOURCE,
    readIdentity:options=>source.readIdentity({...options,signal:task.controller.signal}),
    page:options=>source.page({...options,signal:task.controller.signal})
   };
   const result=await sync({repo,job,source:guarded,signal:task.controller.signal,maxPages,maxMs});
   if(result?.ownerUserId!==verified.ownerUserId||!["completed","paused","incomplete"].includes(result.status))throw Error("sync_failed");
   last={ownerUserId:verified.ownerUserId,status:result.status,at:new Date().toISOString()};
   return last;
  }catch(e){
   last={ownerUserId:task.binding.ownerUserId,status:safeError(e),at:new Date().toISOString()};
   return last;
  }finally{
   try{await source?.close()}catch{}
   if(!source)try{await transport?.close?.()}catch{}
   try{repo?.close()}catch{}
   if(running===task)running=null;
  }
 }
 function start({binding,authorized=false}={}){
  if(authorized!==true)throw Error("access_denied");
  if(!validBinding(binding))throw Error("identity_changed");
  if(typeof openTransport!=="function")throw Error("source_unavailable");
  if(running){
   if(!same(binding,running.binding))throw Error("identity_changed");
   return {accepted:false,running:true};
  }
  const task={binding:{ownerUserId:binding.ownerUserId,handle:binding.handle,sessionId:binding.sessionId},controller:new AbortController(),done:null};
  running=task;last=null;
  task.done=execute(task);
  return {accepted:true,running:true};
 }
 function stop(binding){
  if(!running)return {stopping:false};
  if(!validBinding(binding)||!same(binding,running.binding))throw Error("identity_changed");
  running.controller.abort();
  return {stopping:true};
 }
 function status(binding){
  if(!validBinding(binding))throw Error("identity_changed");
  const task=running;
  if(task&&!same(binding,task.binding)){
   task.controller.abort();
   return {running:false,status:"identity_changed"};
  }
  return {running:!!task,status:last?.ownerUserId===binding.ownerUserId?last.status:null,finishedAt:last?.ownerUserId===binding.ownerUserId?last.at:null};
 }
 async function waitForIdle(){await running?.done;}
 return Object.freeze({start,stop,status,waitForIdle});
}
