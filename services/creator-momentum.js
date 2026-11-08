import {DEFAULT_MOMENTUM_CONFIG,dailyPolicy,createMomentumDay,localDayKey,selectMomentumReminder,recordMomentumReminder} from '../domain/creator-momentum.js';
export const MOMENTUM_OUTBOX_PREFIX='creatorMomentumDelivery:';
export const MOMENTUM_GATE_PREFIX='creatorMomentumGate:';
export const momentumGateKey=ownerId=>MOMENTUM_GATE_PREFIX+encodeURIComponent(ownerId);
export const momentumReceiptKey=(ownerId,requestId)=>MOMENTUM_OUTBOX_PREFIX+encodeURIComponent(ownerId)+':'+requestId;
// A small serial lane for preference mutations arriving from independent
// extension surfaces. Reads remain concurrent; the final received intent wins.
export function createMomentumMutationQueue(){
 let tail=Promise.resolve();
 return operation=>{
  const result=tail.catch(()=>{}).then(operation);
  tail=result.then(()=>undefined,()=>undefined);
  return result;
 };
}
// Included in the existing atomic receipt/history/usage storage.set, not another write.
export function momentumReceiptPatch(receipt,policy=DEFAULT_MOMENTUM_CONFIG,previous=null){
 try{
  if(!receipt?.ownerId||!receipt.input?.requestId||!Number.isFinite(receipt.completedAt)||typeof receipt.raw!=='string')return {};
  const event={ownerId:receipt.ownerId,requestId:receipt.input.requestId,at:receipt.completedAt,day:localDayKey(receipt.completedAt),policy:policy?dailyPolicy(policy):null};
  const first=previous?.ownerId===event.ownerId&&previous?.requestId===event.requestId&&Number.isFinite(previous?.at)?previous:event;
  return {[momentumReceiptKey(event.ownerId,event.requestId)]:first};
 }catch{return {};}
}
const request=r=>new Promise((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
export class MomentumStore {
 constructor({indexedDB=globalThis.indexedDB,name='xrh-creator-momentum-v1',clock=Date.now,random=Math.random}={}){this.indexedDB=indexedDB;this.name=name;this.clock=clock;this.random=random;this.opening=null;this.draining=null;}
 open(){
  if(!this.opening)this.opening=new Promise((resolve,reject)=>{
   if(!this.indexedDB){reject(Error('LOCAL_STATS_UNAVAILABLE'));return;}
   const r=this.indexedDB.open(this.name,1);
   r.onupgradeneeded=()=>{for(const name of ['days','seen','prefs']){const store=r.result.createObjectStore(name);if(name==='seen')store.createIndex('age','at');if(name==='days')store.createIndex('age','createdAt');}};
   r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();this.opening=null;};resolve(r.result);};r.onerror=()=>{this.opening=null;reject(Error('LOCAL_STATS_UNAVAILABLE'));};r.onblocked=()=>{this.opening=null;reject(Error('LOCAL_STATS_BLOCKED'));};
  });return this.opening;
 }
 async transaction(names,action,mode='readwrite'){const db=await this.open(),tx=db.transaction(names,mode);const done=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=tx.onerror=()=>reject(tx.error||Error('LOCAL_STATS_WRITE_FAILED'));});try{const result=await action(tx);await done;return result;}catch(error){try{tx.abort();}catch{}await done.catch(()=>{});throw error;}}
 async ingest(event){
  if(!event||!/^[A-Za-z0-9_-]{1,128}$/.test(event.ownerId)||typeof event.ownerId!=='string'||event.ownerId.length>128||typeof event.requestId!=='string'||!/^[-A-Za-z0-9_]{1,100}$/.test(event.requestId)||!Number.isFinite(event.at)||!/^\d{4}-\d{2}-\d{2}$/.test(event.day))throw Error('INVALID_LOCAL_RECEIPT');
  // Only recent local aggregates are supported. Old upgrade history is never invented.
  if(event.at<this.clock()-32*86400000)return false;
  return this.transaction(['seen','days'],async tx=>{
   const seen=tx.objectStore('seen'),days=tx.objectStore('days'),id=JSON.stringify([event.ownerId,event.requestId]),key=JSON.stringify([event.ownerId,event.day]);
   if(await request(seen.get(id)))return false;
   const day=await request(days.get(key))||(event.policy?createMomentumDay(event.at,event.policy,this.random,event.day):{day:event.day,count:0,createdAt:event.at});
   day.count+=1;day.lastAckAt=Math.max(day.lastAckAt??0,event.at);seen.put({at:event.at},id);days.put(day,key);return true;
  });
 }
 async snapshot(ownerId){
  const key=JSON.stringify([ownerId,localDayKey(this.clock())]);
  return this.transaction(['days','prefs'],async tx=>{
   const day=await request(tx.objectStore('days').get(key));
   const pref=await request(tx.objectStore('prefs').get(ownerId));
   return {count:day?.count??0,dnd:day?.dnd===true,enabled:pref?.enabled===true};
  },'readonly');
 }
 async view(ownerId,policy,{eligible=false,enabled,arm=false,gate=false,claim=false,dnd=false,available=true,assignPolicy=true}={}){
  if(!ownerId)return {eligible:false,enabled:false,available:false,policy};
  // `claim` is accepted only as a compatibility alias for opening the gate.
  gate=gate||claim;
  const now=this.clock(),today=localDayKey(now);
  return this.transaction(['days','prefs'],async tx=>{
   const days=tx.objectStore('days'),prefs=tx.objectStore('prefs'),key=JSON.stringify([ownerId,today]);
   const p=await request(prefs.get(ownerId))||{enabled:false,latestDay:today};
   const saved=await request(days.get(key));
   const day=saved?.thresholds?saved:assignPolicy?{...createMomentumDay(now,policy,this.random),...saved}:{day:today,count:saved?.count??0,createdAt:saved?.createdAt??now,...saved};
   if(enabled===false||eligible&&enabled===true)p.enabled=enabled;
   if(dnd){day.dnd=true;delete day.pendingReminder;}
   const shouldArm=arm||claim;
   const stage=(shouldArm||gate)&&today>=p.latestDay
    ? selectMomentumReminder(day,{eligible,enabled:p.enabled,globalEnabled:policy.enabled},now) : null;
   let reminder=null;
   if(stage&&!day.dnd){
    if(day.pendingReminder?.id!==today+':'+stage){
     reminder={id:today+':'+stage,stage,lease:crypto.randomUUID(),createdAt:now,state:'pending'};
     day.pendingReminder=reminder;
    }else reminder=day.pendingReminder;
    if(gate){reminder={...reminder,state:'presenting',attemptedAt:now};day.pendingReminder=reminder;}
   }
   p.latestDay=p.latestDay>today?p.latestDay:today;prefs.put(p,ownerId);days.put(day,key);
   return {eligible,enabled:p.enabled,available,policy,day:today,count:day.count,dnd:day.dnd===true,reminder:gate?reminder:null,reminderPending:Boolean(day.pendingReminder)};
  });
 }
 async confirmReminder(ownerId,{id,lease,policy=DEFAULT_MOMENTUM_CONFIG}){
  const now=this.clock(),today=localDayKey(now);
  return this.transaction(['days','prefs'],async tx=>{
   const days=tx.objectStore('days'),key=JSON.stringify([ownerId,today]);
   const day=await request(days.get(key));
   const delivered=day?.deliveredReminders||[];
   if((day?.deliveredReminder?.id===id&&day.deliveredReminder.lease===lease)||delivered.some(item=>item.id===id&&item.lease===lease))return {confirmed:true,pending:Boolean(day.pendingReminder)};
   if(!day||day.dnd||day.pendingReminder?.id!==id||day.pendingReminder.lease!==lease)return {confirmed:false,pending:false};
   const pref=await request(tx.objectStore('prefs').get(ownerId));
   if(pref?.latestDay>today)return {confirmed:false,pending:false};
   const next=recordMomentumReminder(day,day.pendingReminder.stage,now);
   next.deliveredReminder={id,lease};
   next.deliveredReminders=[...delivered.filter(item=>item.id!==id),{id,lease}].slice(-3);
   delete next.pendingReminder;
   const nextStage=selectMomentumReminder(next,{eligible:true,enabled:pref?.enabled===true,globalEnabled:policy.enabled===true},now);
   if(nextStage)next.pendingReminder={id:today+':'+nextStage,stage:nextStage,lease:crypto.randomUUID(),createdAt:now,state:'pending'};
   days.put(next,key);
   return {confirmed:true,pending:Boolean(next.pendingReminder)};
  });
 }
 async prune(){
  const cutoff=this.clock()-32*86400000;
  if(!globalThis.IDBKeyRange)return;
  await this.transaction(['seen','days'],async tx=>{for(const name of ['seen','days']){const store=tx.objectStore(name);const keys=await request(store.index('age').getAllKeys(IDBKeyRange.upperBound(cutoff,true),64));for(const key of keys)store.delete(key);}});
 }
 async drain(storage){
  if(this.draining)return this.draining;
  this.draining=(async()=>{
   const data=await storage.get(null);const entries=Object.entries(data).filter(([k])=>k.startsWith(MOMENTUM_OUTBOX_PREFIX));
   // A bounded batch never blocks the original generate/ACK/display operation.
   for(const [key,event]of entries.slice(0,64)){
    try{await this.ingest(event);}catch(error){if(error?.message!=='INVALID_LOCAL_RECEIPT')throw error;}
    await storage.remove(key);
   }
   if(!this.lastPrune||this.clock()-this.lastPrune>3600000){this.lastPrune=this.clock();await this.prune().catch(()=>{});}
   return entries.length<=64;
  })().finally(()=>{this.draining=null;});return this.draining;
 }
}
