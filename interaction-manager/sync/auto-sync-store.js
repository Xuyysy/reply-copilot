// Local scheduling state for an independently approved provider. No live
// transport, browser alarms, permissions or authentication is installed here.
// Each operation is atomic, including competing claims from different contexts.
import {validId} from '../core/events.js';
import {validateAutoSchedule,enableAutoSync,claimAutoSync,settleAutoSync,stopAutoSync,recoverAutoSync} from './auto-sync-policy.js';
const DB='reply-copilot-interaction-schedules-v1',STORE='schedules';
const reasons=new Set([null,'source_exhausted','page_limit','authorization_changed','rate_limited','forbidden','unauthenticated','schema_changed','identity_changed','cancelled','time_limit','source_error','source_unavailable','sync_failed','user_disabled','interrupted']);
function request(r){return new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
function done(tx){return new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error??Error('transaction_aborted'));tx.onerror=()=>reject(tx.error??Error('transaction_failed'));});}
function project(s,owner){
 if(s===null)return null;
 validateAutoSchedule(s);
 if(s.ownerUserId!==owner||!reasons.has(s.reason))throw Error('invalid_schedule');
 const {ownerUserId,providerId,scheduleId,intervalMinutes,state,nextAt,runId,reason}=s;
 return {ownerUserId,providerId,scheduleId,intervalMinutes,state,nextAt,runId,reason};
}
export async function openAutoSyncStore(factory=globalThis.indexedDB,name=DB){
 const r=factory.open(name,1);
 r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{keyPath:'ownerUserId'});
 const db=await request(r);db.onversionchange=()=>db.close();
 async function transaction(owner,mutate){
  if(!validId(owner))throw Error('invalid_owner');
  const tx=db.transaction(STORE,mutate?'readwrite':'readonly'),finished=done(tx),os=tx.objectStore(STORE);
  finished.catch(()=>{});
  try{
   const current=project((await request(os.get(owner)))??null,owner);
   if(!mutate){await finished;return current;}
   const result=mutate(current),next=project(result.schedule,owner);
   if(next!==null&&result.schedule!==current)await request(os.put(next));
   await finished;
   return {...result,schedule:next};
  }catch(e){try{tx.abort();}catch{}await finished.catch(()=>{});throw e;}
 }
 return {
  read:owner=>transaction(owner),
  configure:(owner,args)=>transaction(owner,current=>{
   if(current?.state==='running')throw Error('schedule_busy');
   if(current?.scheduleId===args?.scheduleId)throw Error('schedule_id_reused');
   // Only explicit configure receives a fresh consent gate; no gate is stored.
   return {schedule:enableAutoSync({...args,ownerUserId:owner})};
  }),
  claim:(owner,args)=>transaction(owner,current=>current?claimAutoSync(current,args):{action:'none',schedule:null}),
  settle:(owner,args)=>transaction(owner,current=>({schedule:current?settleAutoSync(current,args):null})),
  disable:owner=>transaction(owner,current=>({schedule:current?stopAutoSync(current):null})),
  // Invoke only after the host establishes that no task owns the lease.
  recover:owner=>transaction(owner,current=>({schedule:current?recoverAutoSync(current):null})),
  close:()=>db.close()
 };
}
