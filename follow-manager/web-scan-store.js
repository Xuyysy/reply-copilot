// Webpage-scan snapshots are isolated from numeric-ID archive snapshots.
const DB = "xrh-follow-web-v1";
const STORE = "snapshots";
function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, {keyPath:"owner"});
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || Error("无法打开本地扫描数据库。"));
    request.onblocked = () => reject(Error("本地数据正在被其他页面占用。"));
  });
}
async function withStore(mode, callback) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      let result;
      try {
        const request = callback(tx.objectStore(STORE));
        if (request) request.onsuccess = () => { result = request.result; };
      } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || Error("本地扫描数据操作失败。"));
      tx.onabort = () => reject(tx.error || Error("本地扫描数据保存中断。"));
    });
  } finally { db.close(); }
}
export const saveWebSnapshot = snapshot => withStore("readwrite", store => store.put(snapshot));
export const readWebSnapshot = owner => withStore("readonly", store => store.get(owner));
export const removeWebSnapshot = owner => withStore("readwrite", store => store.delete(owner));
