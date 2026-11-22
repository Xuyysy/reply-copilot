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
export function saveSnapshot(snapshot) {
  return run(snapshot.owner, "readwrite", store => store.put(snapshot));
}
export function removeSnapshot(owner) {
  return run(owner, "readwrite", (store, key) => store.delete(key));
}
