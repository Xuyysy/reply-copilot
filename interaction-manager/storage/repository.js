import {validId,normalizeEvent,mergeEvent} from '../core/events.js';
const DB='reply-copilot-interactions-v1';
function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function finished(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('transaction_aborted'));tx.onerror=()=>reject(tx.error??Error('transaction_failed'));});}
export async function openInteractionDB(factory=globalThis.indexedDB,name=DB){
  const r=factory.open(name,3);
  r.onupgradeneeded=event=>{
    const db=r.result;
    if(event.oldVersion<1){
    const events=db.createObjectStore('events',{keyPath:'eventId'});
    events.createIndex('owner','ownerUserId');
    events.createIndex('ownerTime',['ownerUserId','occurredAt']);
    db.createObjectStore('session',{keyPath:'key'});
    db.createObjectStore('coverage',{keyPath:['ownerUserId','source']});
    }
    if(event.oldVersion<2){const users=db.createObjectStore('users',{keyPath:['ownerUserId','userId']});users.createIndex('owner','ownerUserId');}
    if(event.oldVersion<3)db.createObjectStore('syncJobs',{keyPath:['ownerUserId','providerId','source']});
  };
  const db=await req(r);
  db.onversionchange=()=>db.close();
  return db;
}
async function transaction(db,stores,mode,work){
  const tx=db.transaction(stores,mode),done=finished(tx);
  // Observe rejection immediately, including validation errors in work.
  done.catch(()=>{});
  try{const result=await work(tx);await done;return result;}catch(e){try{tx.abort();}catch{}await done.catch(()=>{});throw e;}
}
// Called only after a trusted extension context verifies the X identity.
// A new token fences all outstanding writes from the old session.
export async function beginSession(db,ownerUserId){
  if(!validId(ownerUserId))throw Error('owner_unverified');
  const session={key:'active',ownerUserId,token:crypto.randomUUID()};
  await transaction(db,['session'],'readwrite',tx=>req(tx.objectStore('session').put(session)));
  return session;
}
export async function endSession(db,session){
  await transaction(db,['session'],'readwrite',async tx=>{
    const s=tx.objectStore('session'),current=await req(s.get('active'));
    if(current?.token===session?.token)await req(s.delete('active'));
  });
}
async function assertSession(tx,session){
  const current=await req(tx.objectStore('session').get('active'));
  if(!current||!validId(session?.ownerUserId)||current.token!==session.token||current.ownerUserId!==session.ownerUserId)throw Error('stale_session');
}
export async function commitBatch(db,session,inputs,{source,cursor=null,reason='partial',observedAt=Date.now(),users=[],checkpoint=null,signal=null,observedSample=false,recentScan=false}={}){
  if(!Array.isArray(inputs)||inputs.length>1000||!['notification','post','archive','authorized-api'].includes(source)||!['partial','source_exhausted','cancelled','limited','schema_changed'].includes(reason)||!(cursor===null||typeof cursor==='string'&&cursor.length<=2048)||!Number.isSafeInteger(observedAt)||observedAt<=0)throw Error('invalid_batch');
  if(!Array.isArray(users)||users.length>2000)throw Error('invalid_users');
  const observationOnly=observedSample||recentScan;
  if(observedSample&&recentScan||observationOnly&&(checkpoint||cursor!==null||reason!=='partial'||!['notification','post'].includes(source)))throw Error('invalid_batch');
  const records=new Map();let rejected=0;
  for(const input of inputs){const event=normalizeEvent(input,session?.ownerUserId);if(!event||event.source!==source){rejected++;continue;}records.set(event.eventId,mergeEvent(records.get(event.eventId),event));}
  if(observationOnly&&rejected)throw Error('invalid_batch');
  return transaction(db,checkpoint?['session','events','coverage','users','syncJobs']:['session','events','coverage','users'],'readwrite',async tx=>{
    await assertSession(tx,session);
    if(signal?.aborted)throw Error('cancelled');
    let job=null;
    if(checkpoint){
      const {providerId,revision,nextCursor,done}=checkpoint;
      if(checkpoint.quality!=null)for(const key of QUALITY_KEYS)if(!Number.isSafeInteger(checkpoint.quality[key])||checkpoint.quality[key]<0||checkpoint.quality[key]>100000)throw Error('invalid_checkpoint');
      if(!validProvider(providerId)||!Number.isSafeInteger(revision)||revision<0||!validCursor(nextCursor)||typeof done!=='boolean'||done!==(nextCursor===null)||nextCursor!==cursor||reason!==(done?'source_exhausted':'partial')||rejected)throw Error('invalid_checkpoint');
      const store=tx.objectStore('syncJobs');job=await req(store.get([session.ownerUserId,providerId,source]));
      if(!job||job.revision!==revision||job.done)throw Error('stale_checkpoint');
      if(nextCursor!==null&&(job.cursor===nextCursor||job.seen.includes(nextCursor)))throw Error('cursor_cycle');
      if(job.pages>=1000)throw Error('history_limit');
    }
    const events=tx.objectStore('events');
    // Cap the live synchronized account transactionally, not only at render time.
    // If the page exceeds the cap, the whole page and checkpoint roll back.
    const existingCount=(checkpoint||observationOnly)?await req(events.index('owner').count(IDBKeyRange.only(session.ownerUserId))):0;
    let inserted=0,sourceNew=0;
    for(const e of records.values()){const old=await req(events.get(e.eventId));if(!old){inserted++;if((checkpoint||observationOnly)&&existingCount+inserted>50000)throw Error('workspace_limit');}if(!old?.sources?.includes(source))sourceNew++;await req(events.put(mergeEvent(old,e)));}
    const participants=new Set([...records.values()].flatMap(e=>[e.actorUserId,e.targetUserId]));
    const userStore=tx.objectStore('users');
    for(const u of users){if(!u||!participants.has(u.userId)||typeof u.handle!=='string'||! /^[A-Za-z0-9_]{1,15}$/.test(u.handle)||!Number.isSafeInteger(u.observedAt)||u.observedAt<=0||u.observedAt>observedAt)continue;const key=[session.ownerUserId,u.userId],old=await req(userStore.get(key));if(!old||old.observedAt<=u.observedAt)await req(userStore.put({ownerUserId:session.ownerUserId,userId:u.userId,handle:u.handle,observedAt:u.observedAt}));}
    // Never label a source exhaustion as complete account history.
    const coverage=tx.objectStore('coverage'),key=[session.ownerUserId,source];
    const old=await req(coverage.get(key));
    await req(coverage.put({ownerUserId:session.ownerUserId,source,cursor:observationOnly?(old?.cursor??null):cursor,reason:observationOnly?(old?.reason??'partial'):reason,...(recentScan||old?.recentPages?{recentPages:(old?.recentPages??0)+(recentScan?1:0)}:{}),...(observedSample||old?.observedSamples?{observedSamples:(old?.observedSamples??0)+(observedSample?1:0)}:{}),lastObservedAt:observedAt,uniqueEvents:(old?.uniqueEvents??0)+sourceNew,rejected:(old?.rejected??0)+rejected,historyComplete:false}));
    if(signal?.aborted)throw Error('cancelled');
    if(job){const quality=Object.fromEntries(QUALITY_KEYS.map(k=>[k,(job.quality?.[k]??0)+(checkpoint.quality?.[k]??0)]));const next={...job,quality,qualityPages:(job.qualityPages??0)+(checkpoint.quality?1:0),revision:job.revision+1,pages:job.pages+1,cursor:checkpoint.nextCursor,done:checkpoint.done,seen:checkpoint.nextCursor===null?job.seen:[...job.seen,checkpoint.nextCursor],updatedAt:observedAt};await req(tx.objectStore('syncJobs').put(next));if(signal?.aborted)throw Error('cancelled');return {inserted,accepted:records.size,rejected,job:next};}
    return {inserted,accepted:records.size,rejected};
  });
}
// UI may query batches, not materialize the entire account database.
// Resume key is an exact eventId from the same owner. No cross-owner reads.
export async function readEventPage(db,session,{after=null,limit=500}={}){
  if(!Number.isInteger(limit)||limit<1||limit>1000||!(after===null||typeof after==='string'&&after.startsWith(session?.ownerUserId+':')))throw Error('invalid_page');
  return transaction(db,['session','events'],'readonly',async tx=>{
    await assertSession(tx,session);
    const store=tx.objectStore('events');
    const rows=[];
    return new Promise((resolve,reject)=>{
      const prefix=session.ownerUserId+':';
      const r=store.openCursor(IDBKeyRange.bound(after??prefix,prefix+'\uffff',after!==null,false));
      r.onerror=()=>reject(r.error);
      r.onsuccess=()=>{const c=r.result;if(!c){resolve({rows,next:null});return;}
        if(rows.length===limit){resolve({rows,next:rows[rows.length-1].eventId});return;}
        rows.push(c.value);c.continue();
      };
    });
  });
}
export async function readCoverage(db,session){
  return transaction(db,['session','coverage'],'readonly',async tx=>{
    await assertSession(tx,session);
    return (await req(tx.objectStore('coverage').getAll(IDBKeyRange.bound([session.ownerUserId],[session.ownerUserId,[]]))));
  });
}

export async function readUsers(db,session){
  return transaction(db,['session','users'],'readonly',async tx=>{await assertSession(tx,session);return req(tx.objectStore('users').index('owner').getAll(IDBKeyRange.only(session.ownerUserId)));});
}
export async function clearOwner(db,session){
  return transaction(db,['session','events','coverage','users','syncJobs'],'readwrite',async tx=>{
    await assertSession(tx,session);
    const owner=session.ownerUserId;
    await req(tx.objectStore('syncJobs').delete(IDBKeyRange.bound([owner],[owner,[]])));
    for(const name of ['events','users']){
      const store=tx.objectStore(name),keys=await req(store.index('owner').getAllKeys(IDBKeyRange.only(owner)));
      for(const k of keys)await req(store.delete(k));
    }
    await req(tx.objectStore('coverage').delete(IDBKeyRange.bound([owner],[owner,[]])));
  });
}

const QUALITY_KEYS=['unsupported','unresolvedActors','foreignTargets','ignored'];
function validProvider(v){return typeof v==='string'&&/^[a-z0-9-]{1,50}$/.test(v);}
function validCursor(v){return v===null||typeof v==='string'&&v.length>0&&v.length<=2048;}
export async function openSyncJob(db,session,{providerId,legacyProviderId,source,refresh=false}={}){
  if(!validProvider(providerId)||legacyProviderId!==undefined&&(!validProvider(legacyProviderId)||legacyProviderId===providerId)||!['notification','post'].includes(source))throw Error('invalid_job');
  return transaction(db,['session','syncJobs'],'readwrite',async tx=>{
    await assertSession(tx,session);
    const store=tx.objectStore('syncJobs'),key=[session.ownerUserId,providerId,source];let old=await req(store.get(key));
    // Migrate only the exact combined fingerprint of the current endpoints, never an unknown old cursor.
    if(!old&&legacyProviderId!==undefined){const legacyKey=[session.ownerUserId,legacyProviderId,source],legacy=await req(store.get(legacyKey));if(legacy){old={...legacy,providerId};await req(store.put(old));await req(store.delete(legacyKey));}}
    if(old&&!refresh)return old;
    // Explicit refresh starts from the head, without deleting previously committed events.
    const job={ownerUserId:session.ownerUserId,providerId,source,revision:(old?.revision??-1)+1,cursor:null,seen:[],pages:0,done:false,qualityPages:0,quality:{unsupported:0,unresolvedActors:0,foreignTargets:0,ignored:0},updatedAt:Date.now()};
    await req(store.put(job));return job;
  });
}

// A consistent owner-scoped view; events, participant names and coverage are
// from the same read transaction. Never expose opaque continuation cursors.
export async function readOwnerDataset(db,session){
  return transaction(db,['session','events','users','coverage','syncJobs'],'readonly',async tx=>{
    await assertSession(tx,session);
    const owner=session.ownerUserId,range=IDBKeyRange.only(owner);
    const store=tx.objectStore('events').index('owner');
    if(await req(store.count(range))>50000)throw Error('workspace_limit');
    const rows=await req(store.getAll(range));
    const users=await req(tx.objectStore('users').index('owner').getAll(range));
    const ownerRange=IDBKeyRange.bound([owner],[owner,[]]);
    const coverage=(await req(tx.objectStore('coverage').getAll(ownerRange))).map(({source,reason,lastObservedAt,uniqueEvents,rejected,observedSamples,recentPages})=>({source,reason,lastObservedAt,uniqueEvents,rejected,...(Number.isSafeInteger(observedSamples)&&observedSamples>0?{observedSamples}:{}),...(Number.isSafeInteger(recentPages)&&recentPages>0?{recentPages}:{}),historyComplete:false}));
    const jobs=(await req(tx.objectStore('syncJobs').getAll(ownerRange))).map(({providerId,source,pages,done,updatedAt,quality,qualityPages})=>({providerId,source,pages,done,updatedAt,quality,qualityPages}));
    return {ownerUserId:owner,rows,users,coverage,jobs};
  });
}
