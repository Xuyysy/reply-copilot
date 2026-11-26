import {validId,normalizeEvent,mergeEvent} from '../core/events.js';
const DB='reply-copilot-interactions-v1';
function req(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function finished(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('transaction_aborted'));tx.onerror=()=>reject(tx.error??Error('transaction_failed'));});}
export async function openInteractionDB(factory=globalThis.indexedDB,name=DB){
  const r=factory.open(name,1);
  r.onupgradeneeded=()=>{
    const db=r.result;
    const events=db.createObjectStore('events',{keyPath:'eventId'});
    events.createIndex('owner','ownerUserId');
    events.createIndex('ownerTime',['ownerUserId','occurredAt']);
    db.createObjectStore('session',{keyPath:'key'});
    db.createObjectStore('coverage',{keyPath:['ownerUserId','source']});
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
export async function commitBatch(db,session,inputs,{source,cursor=null,reason='partial',observedAt=Date.now()}={}){
  if(!Array.isArray(inputs)||inputs.length>1000||!['notification','post','archive','authorized-api'].includes(source)||!['partial','source_exhausted','cancelled','limited','schema_changed'].includes(reason)||!(cursor===null||typeof cursor==='string'&&cursor.length<=2048)||!Number.isSafeInteger(observedAt)||observedAt<=0)throw Error('invalid_batch');
  const records=new Map();let rejected=0;
  for(const input of inputs){const event=normalizeEvent(input,session?.ownerUserId);if(!event||event.source!==source){rejected++;continue;}records.set(event.eventId,mergeEvent(records.get(event.eventId),event));}
  return transaction(db,['session','events','coverage'],'readwrite',async tx=>{
    await assertSession(tx,session);
    const events=tx.objectStore('events');
    let inserted=0,sourceNew=0;
    for(const e of records.values()){const old=await req(events.get(e.eventId));if(!old)inserted++;if(!old?.sources?.includes(source))sourceNew++;await req(events.put(mergeEvent(old,e)));}
    // Never label a source exhaustion as complete account history.
    const coverage=tx.objectStore('coverage'),key=[session.ownerUserId,source];
    const old=await req(coverage.get(key));
    await req(coverage.put({ownerUserId:session.ownerUserId,source,cursor,reason,lastObservedAt:observedAt,uniqueEvents:(old?.uniqueEvents??0)+sourceNew,rejected:(old?.rejected??0)+rejected,historyComplete:false}));
    return {inserted,accepted:records.size,rejected};
  });
}
// UI may query batches, not materialize the entire account database.
// Resume key is an exact eventId from the same owner. No cross-owner reads.
export async function readEventPage(db,session,{after=null,limit=500}={}){
  if(!Number.isInteger(limit)||limit<1||limit>1000||!(after===null||typeof after==='string'&&after.startsWith(session?.ownerUserId+':')))throw Error('invalid_page');
  return transaction(db,['session','events'],'readonly',async tx=>{
    await assertSession(tx,session);
    const index=tx.objectStore('events').index('owner');
    const rows=[];
    return new Promise((resolve,reject)=>{
      const r=index.openCursor(IDBKeyRange.only(session.ownerUserId));
      r.onerror=()=>reject(r.error);
      r.onsuccess=()=>{const c=r.result;if(!c){resolve({rows,next:null});return;}
        if(after!==null&&c.primaryKey<=after){c.continue();return;}
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
