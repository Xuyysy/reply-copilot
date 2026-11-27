import {stableId} from "./model.js";
import {LIVE_SOURCE} from "./store.js";
const KINDS=["following","followers"];
function verify(value,owner,session,counts){
 if(!value||value.source!==LIVE_SOURCE||value.ownerUserId!==owner||!stableId(owner)||typeof value.sessionId!=="string"||!value.sessionId||value.sessionId.length>128||session!=null&&value.sessionId!==session||value.identityEvidence!=="self_profile_and_session")throw Error("identity_changed");
 if(!counts||!KINDS.every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0&&counts[k]<=50000&&value.counts?.[k]===counts[k]))throw Error("count_changed");
 return value.sessionId;
}
const safeProgress=(f,j)=>{try{f(j)}catch{}};
export async function runAuthorizedSync({repo,job,source,signal,maxPages=60,maxMs=240000,onProgress=()=>{}}){
 if(!repo||!job||job.source!==LIVE_SOURCE||source?.kind!==LIVE_SOURCE||!Number.isInteger(maxPages)||maxPages<1||maxPages>120||!Number.isInteger(maxMs)||maxMs<1||maxMs>240000)throw Error("invalid_sync");
 const owner=job.ownerUserId,counts=job.expectedCounts,deadline=Date.now()+maxMs;let current=job,pages=0;
 const budget=()=>signal?.aborted?"cancelled":Date.now()>=deadline?"time_limit":null;
 async function stop(status){current=await repo.pause(owner,current.jobId,current.lease,status);safeProgress(onProgress,current);return current;}
 async function bounded(fn){let timer,abort;try{
  if(budget())throw Error(budget());
  return await Promise.race([Promise.resolve().then(fn),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error("time_limit")),Math.max(0,deadline-Date.now()));abort=()=>reject(Error("cancelled"));signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();})]);
 }finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}}
 try{
  const id=verify(await bounded(()=>source.readIdentity({signal})),owner,null,counts);
  for(const kind of KINDS)while(!current.stages[kind].terminal){
   if(pages>=maxPages||budget())return await stop("paused");
   verify(await bounded(()=>source.readIdentity({signal})),owner,id,counts);
   const cursor=current.stages[kind].cursor;
   const p=await bounded(()=>source.page({ownerUserId:owner,kind,cursor,signal}));
   verify(await bounded(()=>source.readIdentity({signal})),owner,id,counts);
   if(budget())return await stop("paused");
   if(!p||p.ownerUserId!==owner||p.kind!==kind||p.cursor!==cursor||p.expected!==counts[kind]||p.coverage!=="authorized_observed"||p.terminal&&p.terminalEvidence!=="explicit_or_count_confirmed")throw Error("source_page_mismatch");
   current=await repo.append(owner,current.jobId,current.lease,kind,p);pages++;safeProgress(onProgress,current);
  }
  const final=await bounded(()=>source.readIdentity({refresh:true,signal}));verify(final,owner,id,counts);
  if(budget())return await stop("paused");
  current=await repo.finalize(owner,current.jobId,current.lease,final.counts);safeProgress(onProgress,current);return current;
 }catch(e){
  const code=e?.message;
  try{await stop(code==="rate_limited"?"rate_limited":["cancelled","time_limit"].includes(code)?"paused":"failed")}catch{}
  throw e;
 }
}
