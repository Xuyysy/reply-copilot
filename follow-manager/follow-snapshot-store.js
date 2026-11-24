// One reusable IndexedDB implementation for independently stored DOM & X-client modes.
// v2 migrates existing v1 "snapshots" records in place (no destructive upgrade).
// Only complete snapshots enter history; stage checkpoints never appear as results.
export function createFollowStore(dbName) {
  const MAX_HISTORY = 5;
  function open() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open(dbName,2);
      request.onupgradeneeded=()=>{
        const db=request.result;
        if(!db.objectStoreNames.contains("snapshots"))
          db.createObjectStore("snapshots",{keyPath:"owner"});
        if(!db.objectStoreNames.contains("pending"))
          db.createObjectStore("pending",{keyPath:"owner"});
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error || Error("无法读取本地关系数据。"));
      request.onblocked=()=>reject(Error("请关闭其他互关助手标签页后重试。"));
    });
  }
  async function perform(stores, mode, schedule) {
    const db=await open();
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(stores,mode);
        let answer;
        tx.oncomplete=()=>resolve(answer);
        tx.onerror=()=>reject(tx.error || Error("本地数据操作失败。"));
        tx.onabort=()=>reject(tx.error || Error("本地数据操作已取消。"));
        try {
          schedule(tx,value=>{answer=value;});
        } catch(error) {
          tx.abort();
          reject(error);
        }
      });
    } finally {db.close();}
  }
  function compact(snapshot) {
    return {
      owner:snapshot.owner,source:snapshot.source,importedAt:snapshot.importedAt,
      following:snapshot.following,followers:snapshot.followers,
      verification:snapshot.verification,ids:snapshot.ids,directional:snapshot.directional,reasons:snapshot.reasons
    };
  }
  function readSnapshot(owner) {
    return perform(["snapshots"],"readonly",(tx,done)=>{
      tx.objectStore("snapshots").get(owner).onsuccess=event=>done(event.target.result);
    });
  }
  function saveSnapshot(snapshot) {
    return perform(["snapshots","pending"],"readwrite",(tx,done)=>{
      const store=tx.objectStore("snapshots");
      store.get(snapshot.owner).onsuccess=event=>{
        const existing=event.target.result;
        const history=existing && existing.importedAt !== snapshot.importedAt ?
          [compact(existing),...(Array.isArray(existing.history) ? existing.history : [])].slice(0,MAX_HISTORY) :
          Array.isArray(existing?.history) ? existing.history.slice(0,MAX_HISTORY) : [];
        const record={...snapshot,history};
        store.put(record);
        tx.objectStore("pending").delete(snapshot.owner);
        done(record);
      };
    });
  }
  function deleteSnapshot(owner) {
    return perform(["snapshots","pending"],"readwrite",tx=>{
      tx.objectStore("snapshots").delete(owner);
      tx.objectStore("pending").delete(owner);
    });
  }
  function readPending(owner) {
    return perform(["pending"],"readonly",(tx,done)=>{
      tx.objectStore("pending").get(owner).onsuccess=event=>done(event.target.result);
    });
  }
  function savePending(pending) {
    return perform(["pending"],"readwrite",tx=>{
      tx.objectStore("pending").put(pending);
    });
  }
  function clearPending(owner) {
    return perform(["pending"],"readwrite",tx=>{
      tx.objectStore("pending").delete(owner);
    });
  }
  return {readSnapshot,saveSnapshot,deleteSnapshot,readPending,savePending,clearPending};
}
