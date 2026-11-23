// Internal X web-client sync snapshots, isolated from archive and DOM modes.
// IndexedDB lives inside the extension. Nothing is sent to the product API.
const DB = "xrh-follow-internal-v1";
const STORE = "snapshots";
function open() {
  return new Promise((resolve,reject) => {
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{
      if(!req.result.objectStoreNames.contains(STORE)){
        req.result.createObjectStore(STORE,{keyPath:"owner"});
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("无法打开本地关注数据库。"));
    req.onblocked=()=>reject(new Error("本地数据库正被其他页面占用。"));
  });
}
async function operation(mode,fn) {
  const db=await open();
  try {
    return await new Promise((resolve,reject)=>{
      const tx=db.transaction(STORE,mode);
      let value;
      try {
        const request=fn(tx.objectStore(STORE));
        if(request)request.onsuccess=()=>{value=request.result;};
      } catch(error){reject(error);return;}
      tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>reject(tx.error||Error("本地操作失败。"));
      tx.onabort=()=>reject(tx.error||Error("本地操作取消。"));
    });
  } finally { db.close(); }
}
export const saveInternalSnapshot = snapshot => operation("readwrite",store=>store.put(snapshot));
export const readInternalSnapshot = owner => operation("readonly",store=>store.get(owner));
export const removeInternalSnapshot = owner => operation("readwrite",store=>store.delete(owner));
