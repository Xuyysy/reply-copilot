// Serialize read-modify-write records. Web Locks also coordinate extension pages;
// the fallback keeps isolated tests / one worker safe without adding permissions.
const queues=new WeakMap();
export function withLocalRecordWrite(storage,action){
  if(globalThis.navigator?.locks?.request)return navigator.locks.request('xrh-local-records-v1',action);
  const run=(queues.get(storage)||Promise.resolve()).catch(()=>{}).then(action);
  queues.set(storage,run.catch(()=>{}));return run;
}
