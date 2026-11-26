import {stableId,userRef,emptyStage,nextStage,completeness,relationshipById} from "./model.js";
export const DB_NAME="xrh-follow-v2-local";
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const stores=["owners","jobs","rows"];
export async function openRepository(factory=globalThis.indexedDB){
 const request=factory.open(DB_NAME,1);
 request.onupgradeneeded=()=>{const db=request.result;db.createObjectStore("owners",{keyPath:"ownerUserId"});db.createObjectStore("jobs",{keyPath:"jobId"});const rows=db.createObjectStore("rows",{keyPath:["jobId","kind","userId"]});rows.createIndex("byJob","jobId");};
 request.onblocked=()=>{};
 const db=await req(request);db.onversionchange=()=>db.close();
 async function tx(names,mode,work){
  const tr=db.transaction(names,mode);
  const done=new Promise((res,rej)=>{tr.oncomplete=res;tr.onabort=()=>rej(tr.error||Error("transaction_aborted"));tr.onerror=()=>{}});
  try{const value=await work(Object.fromEntries(names.map(n=>[n,tr.objectStore(n)])));await done;return value;}
  catch(e){try{tr.abort()}catch{}await done.catch(()=>{});throw e;}
 }
 const verify=(owner,job,lease)=>{if(!owner||!job||owner.activeJobId!==job.jobId||job.ownerUserId!==owner.ownerUserId||job.lease!==lease||job.status!=="syncing")throw Error("stale_job")};
 const clock=()=>new Date().toISOString();
 async function start(ownerUserId,source){
  if(!stableId(ownerUserId)||source!=="fixture")throw Error("invalid_source");
  return tx(["owners","jobs"],"readwrite",async ({owners,jobs})=>{
   let owner=await req(owners.get(ownerUserId))||{ownerUserId,activeJobId:null,snapshotIds:[]};
   if(owner.activeJobId)throw Error("job_exists");
   const job={ownerUserId,jobId:crypto.randomUUID(),lease:crypto.randomUUID(),source,status:"syncing",createdAt:clock(),stages:{following:emptyStage(),followers:emptyStage()}};
   owner.activeJobId=job.jobId;await req(jobs.add(job));await req(owners.put(owner));return job;
  });
 }
 async function active(ownerUserId){return tx(["owners","jobs"],"readonly",async ({owners,jobs})=>{const o=await req(owners.get(ownerUserId));return o?.activeJobId?req(jobs.get(o.activeJobId)):null;})}
 async function resume(ownerUserId,jobId,oldLease){
  return tx(["owners","jobs"],"readwrite",async ({owners,jobs})=>{
   const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));
   if(!o||!j||o.activeJobId!==jobId||j.ownerUserId!==ownerUserId||j.lease!==oldLease||!["paused","syncing","interrupted"].includes(j.status))throw Error("stale_job");
   j.lease=crypto.randomUUID();j.status="syncing";await req(jobs.put(j));return j;
  });
 }
 async function append(ownerUserId,jobId,lease,kind,page){
  if(!["followers","following"].includes(kind)||!Array.isArray(page?.users)||page.users.length>1000)throw Error("invalid_page");
  const now=clock(),users=new Map(page.users.map(x=>{const u=userRef(x,now);return [u.userId,u]}));
  return tx(stores,"readwrite",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));verify(o,j,lease);
   const stage=j.stages[kind];
   if(page.cursor!==stage.cursor)throw Error("stale_page");
   let added=0;
   for(const u of users.values()){const key=[jobId,kind,u.userId];if(!(await req(rows.getKey(key))))added++;await req(rows.put({jobId,kind,...u}));}
   j.stages[kind]=nextStage(stage,page,added,now);await req(jobs.put(j));return j;
  });
 }
 async function pause(ownerUserId,jobId,lease,status="paused"){
  if(!["paused","interrupted","failed","rate_limited"].includes(status))throw Error("invalid_status");
  return tx(["owners","jobs"],"readwrite",async ({owners,jobs})=>{const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));verify(o,j,lease);j.status=status;await req(jobs.put(j));return j;});
 }
 async function removeRows(rows,jobId){const keys=await req(rows.index("byJob").getAllKeys(jobId));for(const key of keys)await req(rows.delete(key));}
 async function discard(ownerUserId,jobId,lease){
  return tx(stores,"readwrite",async ({owners,jobs,rows})=>{const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));if(!o||!j||j.ownerUserId!==ownerUserId||o.activeJobId!==jobId||j.lease!==lease)throw Error("stale_job");await removeRows(rows,jobId);await req(jobs.delete(jobId));o.activeJobId=null;await req(owners.put(o));});
 }
 async function finalize(ownerUserId,jobId,lease){
  return tx(stores,"readwrite",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));verify(o,j,lease);
   if(!j.stages.following.terminal||!j.stages.followers.terminal)throw Error("unfinished");
   j.completeness=completeness(j.stages);j.status=j.completeness==="complete"?"completed":"incomplete";j.capturedAt=clock();
   await req(jobs.put(j));
   // Only a verified fixture result replaces the prior fixture snapshot. Never export fixtures as real relations.
   if(j.completeness==="complete"){o.snapshotIds=[jobId,...o.snapshotIds];for(const old of o.snapshotIds.slice(6)){await removeRows(rows,old);await req(jobs.delete(old));}o.snapshotIds=o.snapshotIds.slice(0,6);o.activeJobId=null;}
   await req(owners.put(o));return j;
  });
 }
 async function readSnapshot(ownerUserId,offset=0){
  return tx(stores,"readonly",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),id=o?.snapshotIds?.[offset];if(!id)return null;
   const j=await req(jobs.get(id));if(!j||j.ownerUserId!==ownerUserId||j.status!=="completed")return null;
   const data=await req(rows.index("byJob").getAll(id));return {ownerUserId,capturedAt:j.capturedAt,completeness:j.completeness,relationshipByUserId:relationshipById(data,j.completeness),users:data,source:j.source};
  });
 }
 // Public integration seam is fail-closed. The fixture database is never a real relationship source.
 async function readFollowSnapshot(ownerUserId){if(!stableId(ownerUserId))throw Error("invalid_owner");return {ownerUserId,capturedAt:null,completeness:"unknown",relationshipByUserId:{}}}
 async function purge(ownerUserId){return tx(stores,"readwrite",async ({owners,jobs,rows})=>{const o=await req(owners.get(ownerUserId));if(!o)return;for(const id of new Set([o.activeJobId,...o.snapshotIds].filter(Boolean))){await removeRows(rows,id);await req(jobs.delete(id));}await req(owners.delete(ownerUserId));});}
 return {start,active,resume,append,pause,discard,finalize,readSnapshot,readFollowSnapshot,purge,close:()=>db.close()};
}
