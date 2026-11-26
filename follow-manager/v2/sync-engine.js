import {stableId} from "./model.js";
function stopCode(e){return e?.message==="rate_limited"?"rate_limited":e?.message==="cancelled"||e?.name==="AbortError"?"paused":"failed";}
function verify(identity,owner,sessionId){
 if(!identity||identity.source!=="fixture"||identity.ownerUserId!==owner||typeof identity.sessionId!=="string"||!identity.sessionId||
    (sessionId!==undefined&&identity.sessionId!==sessionId))throw Error("identity_changed");
}
// Only the fixture source is enabled. A live source must be separately reviewed; the
// current store also refuses non-fixture jobs and its shared read contract remains unknown.
export async function runFixtureSync({repo,job,source,signal,shouldPause=()=>false,onProgress=()=>{},yieldControl=()=>Promise.resolve()}){
 if(!repo||!job||job.source!=="fixture"||source?.kind!=="fixture"||!stableId(job.ownerUserId))throw Error("source_not_enabled");
 const owner=job.ownerUserId;let current=job;
 const stopped=()=>signal?.aborted||shouldPause();
 async function checkpointStop(){
  current=await repo.pause(owner,current.jobId,current.lease,"paused");onProgress(current);return current;
 }
 try{
  if(stopped())return await checkpointStop();
  const initial=await source.readIdentity();verify(initial,owner);
  for(const kind of ["following","followers"]){
   while(!current.stages[kind].terminal){
    if(stopped())return await checkpointStop();
    verify(await source.readIdentity(),owner,initial.sessionId);
    if(stopped())return await checkpointStop();
    const cursor=current.stages[kind].cursor;
    const p=await source.page({ownerUserId:owner,kind,cursor,signal});
    verify(await source.readIdentity(),owner,initial.sessionId);
    if(stopped())return await checkpointStop();
    if(!p||p.cursor!==cursor||p.expected!==current.fixtureSize||p.coverage!=="unverified_source")throw Error("source_page_mismatch");
    current=await repo.append(owner,current.jobId,current.lease,kind,p);
    onProgress(current);await yieldControl();
   }
  }
  verify(await source.readIdentity(),owner,initial.sessionId);
  if(stopped())return await checkpointStop();
  current=await repo.finalize(owner,current.jobId,current.lease);
  onProgress(current);return current;
 }catch(e){
  // Do not rotate another tab's lease or overwrite its status.
  try{current=await repo.pause(owner,current.jobId,current.lease,stopCode(e));onProgress(current);}catch{}
  throw e;
 }
}
