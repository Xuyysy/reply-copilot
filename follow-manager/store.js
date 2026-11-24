import {mergeVerification} from "./verification.js";
// Only the extension's own origin can open this IndexedDB. No backend sync.
const DATABASE = "xrh-follow-manager-v1";
const STORE = "snapshots";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, {keyPath:"owner"});
    };
    request.onerror = () => reject(request.error || new Error("本地数据库无法打开。"));
    request.onblocked = () => reject(new Error("本地数据暂被其他页面占用，请关闭其他互关助手页面重试。"));
    request.onsuccess = () => resolve(request.result);
  });
}

async function run(owner, mode, operation) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      let value;
      let tx;
      try {
        tx = db.transaction(STORE, mode);
        const request = operation(tx.objectStore(STORE), owner);
        if (request) request.onsuccess = () => { value = request.result; };
        tx.oncomplete = () => resolve(value);
        tx.onabort = () => reject(tx.error || new Error("本地数据操作已中止。"));
        tx.onerror = () => reject(tx.error || new Error("本地数据操作失败。"));
      } catch (error) { reject(error); }
    });
  } finally { db.close(); }
}

export function readSnapshot(owner) {
  return run(owner, "readonly", (store, key) => store.get(key));
}
// Read/merge/write in one transaction to preserve labels across archive updates.
async function updateRecord(owner,transform) {
  const db=await openDatabase();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,"readwrite"),store=tx.objectStore(STORE);
      let result,problem;
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(problem||tx.error||new Error("本地记录写入失败。"));
      tx.onerror=()=>reject(tx.error||new Error("本地记录写入失败。"));
      store.get(owner).onsuccess=event=>{
        try {result=transform(event.target.result);store.put(result);}
        catch(error){problem=error;tx.abort();}
      };
    });
  }finally{db.close();}
}
export function saveSnapshot(snapshot) {
  return updateRecord(snapshot.owner,previous=>({...snapshot,
    verification:mergeVerification({...snapshot,verification:previous?.verification},null)}));
}
export function saveVerification(owner,importedAt,changes) {
  return updateRecord(owner,record=>{
    if(!record||record.importedAt!==importedAt)throw new Error("归档记录已变化，请重新打开后操作。");
    return {...record,verification:mergeVerification(record,changes)};
  });
}
export function removeSnapshot(owner) {
  return run(owner, "readwrite", (store, key) => store.delete(key));
}

// Pick the newest existing archive without an IndexedDB schema migration.
// Cursor traversal retains at most one winning snapshot, not all accounts.
export function readLatestSnapshot() {
  return openDatabase().then(async db=>{
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(STORE,"readonly");
        const req=tx.objectStore(STORE).openCursor();
        let best=null;
        req.onsuccess=()=>{
          const cursor=req.result;
          if(!cursor)return;
          const record=cursor.value;
          if(record && typeof record.owner==="string" && Array.isArray(record.followers) &&
             Array.isArray(record.following) &&
             (!best || String(record.importedAt||"")>String(best.importedAt||"")))best=record;
          cursor.continue();
        };
        tx.oncomplete=()=>resolve(best);
        tx.onerror=()=>reject(tx.error||new Error("无法读取本地记录。"));
        tx.onabort=()=>reject(tx.error||new Error("本地读取已中止。"));
      });
    } finally {db.close();}
  });
}
