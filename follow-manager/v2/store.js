import {stableId,userRef,emptyStage,nextStage,completeness,relationshipById} from "./model.js";
export const DB_NAME="xrh-follow-v2-local";
export const LIVE_DB_NAME="xrh-follow-v2-authorized";
export const LIVE_SOURCE="x-web-authorized";
const req=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
const stores=["owners","jobs","rows"];
export async function openRepository(factory=globalThis.indexedDB,{live=false}={}){
 const sourceKind=live?LIVE_SOURCE:"fixture";
 const request=factory.open(live?LIVE_DB_NAME:DB_NAME,2);
 request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains("owners"))db.createObjectStore("owners",{keyPath:"ownerUserId"});if(!db.objectStoreNames.contains("jobs"))db.createObjectStore("jobs",{keyPath:"jobId"});if(!db.objectStoreNames.contains("rows")){const rows=db.createObjectStore("rows",{keyPath:["jobId","kind","userId"]});rows.createIndex("byJob","jobId");}if(!db.objectStoreNames.contains("protected")){const p=db.createObjectStore("protected",{keyPath:["ownerUserId","userId"]});p.createIndex("byOwner","ownerUserId");}};
 const db=await new Promise((resolve,reject)=>{let blocked=false;request.onblocked=()=>{blocked=true;reject(Error("database_blocked"))};request.onerror=()=>reject(request.error);request.onsuccess=()=>{if(blocked)request.result.close();else resolve(request.result)}});db.onversionchange=()=>db.close();
 async function tx(names,mode,work){
  const tr=db.transaction(names,mode);
  const done=new Promise((res,rej)=>{tr.oncomplete=res;tr.onabort=()=>rej(tr.error||Error("transaction_aborted"));tr.onerror=()=>{}});
  try{const value=await work(Object.fromEntries(names.map(n=>[n,tr.objectStore(n)])));await done;return value;}
  catch(e){try{tr.abort()}catch{}await done.catch(()=>{});throw e;}
 }
 const verify=(owner,job,lease)=>{if(!owner||!job||owner.activeJobId!==job.jobId||job.ownerUserId!==owner.ownerUserId||job.lease!==lease||job.status!=="syncing")throw Error("stale_job")};
 const clock=()=>new Date().toISOString();
 async function start(ownerUserId,source,fixtureSize=100){
  if(!stableId(ownerUserId)||source!==sourceKind)throw Error("invalid_source");
  const counts=live?fixtureSize:null;
  if(live?(!counts||!["following","followers"].every(k=>Number.isSafeInteger(counts[k])&&counts[k]>=0&&counts[k]<=50000)):(!Number.isSafeInteger(fixtureSize)||fixtureSize<0||fixtureSize>50000))throw Error("invalid_count");
  return tx(["owners","jobs"],"readwrite",async ({owners,jobs})=>{
   let owner=await req(owners.get(ownerUserId))||{ownerUserId,activeJobId:null,snapshotIds:[]};
   if(owner.activeJobId)throw Error("job_exists");
   const job={ownerUserId,jobId:crypto.randomUUID(),lease:crypto.randomUUID(),source,...(live?{expectedCounts:{following:counts.following,followers:counts.followers}}:{fixtureSize}),status:"syncing",createdAt:clock(),stages:{following:emptyStage(),followers:emptyStage()}};
   owner.activeJobId=job.jobId;await req(jobs.add(job));await req(owners.put(owner));return job;
  });
 }
 async function active(ownerUserId){return tx(["owners","jobs"],"readonly",async ({owners,jobs})=>{const o=await req(owners.get(ownerUserId));return o?.activeJobId?req(jobs.get(o.activeJobId)):null;})}
 async function resume(ownerUserId,jobId,oldLease){
  return tx(["owners","jobs"],"readwrite",async ({owners,jobs})=>{
   const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));
   if(!o||!j||o.activeJobId!==jobId||j.ownerUserId!==ownerUserId||j.lease!==oldLease||!["paused","syncing","interrupted","rate_limited"].includes(j.status))throw Error("stale_job");
   if(j.source!==sourceKind)throw Error("invalid_source");
   if(!live&&!Number.isSafeInteger(j.fixtureSize)){const n=j.stages.following.expected??j.stages.followers.expected;if(!Number.isSafeInteger(n))throw Error("legacy_fixture_size_unknown");j.fixtureSize=n;}
   j.lease=crypto.randomUUID();j.status="syncing";await req(jobs.put(j));return j;
  });
 }
 async function append(ownerUserId,jobId,lease,kind,page){
  if(!["followers","following"].includes(kind)||!Array.isArray(page?.users)||page.users.length>1000)throw Error("invalid_page");
  const now=clock(),users=new Map(page.users.map(x=>{const u=userRef(x,now);return [u.userId,u]}));
  return tx(stores,"readwrite",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));verify(o,j,lease);
   if(j.source!==sourceKind||live&&(page.expected!==j.expectedCounts?.[kind]||page.coverage!=="authorized_observed"))throw Error("source_page_mismatch");
   const stage=j.stages[kind];
   if(page.cursor!==stage.cursor)throw Error("stale_page");
   const unique=[...users.values()];
   const existing=await Promise.all(unique.map(u=>req(rows.getKey([jobId,kind,u.userId]))));
   const added=existing.filter(x=>x===undefined).length;
   j.stages[kind]=nextStage(stage,page,added,now);
   await Promise.all(unique.map(u=>req(rows.put({jobId,kind,...u}))));await req(jobs.put(j));return j;
  });
 }
 async function pause(ownerUserId,jobId,lease,status="paused"){
  if(!["paused","interrupted","failed","rate_limited"].includes(status))throw Error("invalid_status");
  return tx(["owners","jobs"],"readwrite",async ({owners,jobs})=>{const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));verify(o,j,lease);j.status=status;await req(jobs.put(j));return j;});
 }
 async function removeRows(rows,jobId){await new Promise((resolve,reject)=>{const cursor=rows.index("byJob").openCursor(IDBKeyRange.only(jobId));cursor.onerror=()=>reject(cursor.error);cursor.onsuccess=()=>{const c=cursor.result;if(!c){resolve();return;}const d=c.delete();d.onerror=()=>reject(d.error);d.onsuccess=()=>c.continue();};});}
 async function discard(ownerUserId,jobId,lease){
  return tx(stores,"readwrite",async ({owners,jobs,rows})=>{const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));if(!o||!j||j.ownerUserId!==ownerUserId||o.activeJobId!==jobId||j.lease!==lease)throw Error("stale_job");await removeRows(rows,jobId);await req(jobs.delete(jobId));o.activeJobId=null;await req(owners.put(o));});
 }
 async function finalize(ownerUserId,jobId,lease,finalCounts=null){
  return tx(stores,"readwrite",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),j=await req(jobs.get(jobId));verify(o,j,lease);
   if(!j.stages.following.terminal||!j.stages.followers.terminal)throw Error("unfinished");
   if(j.source!==sourceKind)throw Error("invalid_source");
   if(live&&(!finalCounts||!["following","followers"].every(k=>finalCounts[k]===j.expectedCounts?.[k])))throw Error("count_changed");
   j.completeness=completeness(j.stages);j.status=j.completeness==="complete"?"completed":"incomplete";j.capturedAt=clock();
   await req(jobs.put(j));
   // Only count-consistent exhausted lists replace the prior snapshot in this isolated source store.
   if(j.completeness==="complete"){o.snapshotIds=[jobId,...o.snapshotIds];for(const old of o.snapshotIds.slice(6)){await removeRows(rows,old);await req(jobs.delete(old));}o.snapshotIds=o.snapshotIds.slice(0,6);o.activeJobId=null;}
   await req(owners.put(o));return j;
  });
 }
 async function readSnapshot(ownerUserId,offset=0){
  return tx(stores,"readonly",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),id=o?.snapshotIds?.[offset];if(!id)return null;
   const j=await req(jobs.get(id));if(!j||j.ownerUserId!==ownerUserId||j.status!=="completed"||j.source!==sourceKind)return null;
   const data=await req(rows.index("byJob").getAll(id));return {ownerUserId,capturedAt:j.capturedAt,completeness:j.completeness,relationshipByUserId:relationshipById(data,j.completeness),users:data,source:j.source};
  });
 }
 // Snapshot identifiers remain stable when a new sync shifts retention offsets.
 async function listSnapshots(ownerUserId){
  if(!stableId(ownerUserId))throw Error("invalid_owner");
  return tx(["owners","jobs"],"readonly",async ({owners,jobs})=>{
   const o=await req(owners.get(ownerUserId));if(!o)return [];
   const found=await Promise.all(o.snapshotIds.map(id=>req(jobs.get(id))));
   return found.filter(j=>j&&j.ownerUserId===ownerUserId&&j.status==="completed"&&j.source===sourceKind&&j.completeness==="complete").map(j=>({
    snapshotId:j.jobId,ownerUserId,capturedAt:j.capturedAt,source:j.source,completeness:j.completeness,
    followers:j.stages.followers.count,following:j.stages.following.count,
    startedAt:j.stages.following.startedAt??j.createdAt,finishedAt:j.stages.followers.finishedAt??j.capturedAt
   }));
  });
 }
 // Resolve both selected snapshots inside one read transaction. Refuse evicted,
 // cross-owner, unordered or partial records; do not silently compare another pair.
 async function readHistoryPair(ownerUserId,newerId,olderId){
  if(!stableId(ownerUserId)||typeof newerId!=="string"||typeof olderId!=="string"||newerId===olderId)throw Error("invalid_pair");
  return tx(stores,"readonly",async ({owners,jobs,rows})=>{
   const o=await req(owners.get(ownerUserId)),ids=o?.snapshotIds||[];
   const a=ids.indexOf(newerId),b=ids.indexOf(olderId);if(a<0||b<0||a>=b)throw Error("invalid_pair");
   async function read(id){
    const j=await req(jobs.get(id));if(!j||j.ownerUserId!==ownerUserId||j.status!=="completed"||j.source!==sourceKind||j.completeness!=="complete")throw Error("invalid_snapshot");
    const data=await req(rows.index("byJob").getAll(id));
    return {snapshotId:id,ownerUserId,capturedAt:j.capturedAt,completeness:j.completeness,relationshipByUserId:relationshipById(data,j.completeness),users:data,source:j.source};
   }
   const [current,prior]=await Promise.all([read(newerId),read(olderId)]);return {current,prior};
  });
 }
 // Fixture data never crosses the public read seam. Live consumers must independently verify current owner.
 async function readFollowSnapshot(ownerUserId){if(!stableId(ownerUserId))throw Error("invalid_owner");
  // No verified live provider has been wired into the product yet.
  return {ownerUserId,capturedAt:null,completeness:"unknown",relationshipByUserId:{}};
 }
 async function readProgress(ownerUserId){return tx(stores,"readonly",async({owners,jobs,rows})=>{
  const o=await req(owners.get(ownerUserId)),j=o?.activeJobId?await req(jobs.get(o.activeJobId)):null;
  if(!j||j.ownerUserId!==ownerUserId||j.source!==sourceKind)return null;
  const data=await req(rows.index("byJob").getAll(j.jobId));return {ownerUserId,capturedAt:null,completeness:"partial",relationshipByUserId:relationshipById(data,"partial"),users:data,source:j.source};
 });}
 // Consistent cache view: current checkpoint, retained snapshots and protection
 // are resolved from a single readonly transaction. No network or public bridge.
 async function readDashboard(ownerUserId){
  if(!stableId(ownerUserId))throw Error("invalid_owner");
  return tx([...stores,"protected"],"readonly",async({owners,jobs,rows,protected:p})=>{
   const o=await req(owners.get(ownerUserId));
   if(!o)return {ownerUserId,snapshot:null,progress:null,history:[],protectedUsers:[]};
   const valid=j=>j&&j.ownerUserId===ownerUserId&&j.source===sourceKind;
   const history=(await Promise.all(o.snapshotIds.map(id=>req(jobs.get(id))))).filter(j=>valid(j)&&j.status==="completed"&&j.completeness==="complete").map(j=>({snapshotId:j.jobId,capturedAt:j.capturedAt,followers:j.stages.followers.count,following:j.stages.following.count}));
   const activeJob=o.activeJobId?await req(jobs.get(o.activeJobId)):null;
   const materialize=async(id,quality,capturedAt)=>{
    const data=await req(rows.index("byJob").getAll(id));
    return {ownerUserId,snapshotId:id,source:sourceKind,completeness:quality,capturedAt,relationshipByUserId:relationshipById(data,quality),users:data};
   };
   const snapshot=history.length?await materialize(history[0].snapshotId,"complete",history[0].capturedAt):null;
   let progress=null;
   if(valid(activeJob)){
    const j=activeJob;
    progress={status:j.status,following:{count:j.stages.following.count,expected:j.expectedCounts?.following??j.stages.following.expected},followers:{count:j.stages.followers.count,expected:j.expectedCounts?.followers??j.stages.followers.expected},view:await materialize(j.jobId,"partial",null)};
   }
   const protectedUsers=await req(p.index("byOwner").getAll(ownerUserId));
   return {ownerUserId,snapshot,progress,history,protectedUsers};
  });
 }
 async function listProtected(ownerUserId){if(!stableId(ownerUserId))throw Error("invalid_owner");return tx(["protected"],"readonly",async s=>req(s.protected.index("byOwner").getAll(ownerUserId)));}
 async function setProtected(ownerUserId,userId,enabled,note=""){if(!stableId(ownerUserId)||!stableId(userId)||typeof enabled!=="boolean"||typeof note!=="string"||note.length>500)throw Error("invalid_protection");return tx(["protected"],"readwrite",async s=>{if(enabled)await req(s.protected.put({ownerUserId,userId,note,updatedAt:clock()}));else await req(s.protected.delete([ownerUserId,userId]));});}
 async function purge(ownerUserId){if(!stableId(ownerUserId))throw Error("invalid_owner");return tx([...stores,"protected"],"readwrite",async ({owners,jobs,rows,protected:p})=>{const o=await req(owners.get(ownerUserId));if(o){for(const id of new Set([o.activeJobId,...o.snapshotIds].filter(Boolean))){await removeRows(rows,id);await req(jobs.delete(id));}await req(owners.delete(ownerUserId));}const keys=await req(p.index("byOwner").getAllKeys(ownerUserId));await Promise.all(keys.map(k=>req(p.delete(k))));});}
 return {start,active,resume,append,pause,discard,finalize,readSnapshot,readProgress,listSnapshots,readHistoryPair,readFollowSnapshot,readDashboard,listProtected,setProtected,purge,close:()=>db.close()};
}
