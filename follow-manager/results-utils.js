// Pure local model helpers for relationship list filtering and history.
// Unknown verification is distinct from confirmed non-blue-verified.
export const MAX_USERS_PER_KIND = 30000;
const VALID_HANDLE = /^[a-z0-9_]{1,15}$/;
const VALID_ID = /^[1-9]\d{0,19}$/;
export function verificationFor(snapshot, handle, kind) {
  const result = own(kind?directionMap(snapshot,kind,"verification"):snapshot?.verification,handle);
  return typeof result === "boolean" ? result : null;
}
export function validVerification(map) {
  return map == null || (typeof map === "object" && !Array.isArray(map) &&
    Object.keys(map).length <= 2 * MAX_USERS_PER_KIND &&
    Object.entries(map).every(([handle, value]) => VALID_HANDLE.test(handle) &&
      typeof value === "boolean"));
}
export function validIds(map) {
  return map == null || (typeof map === "object" && !Array.isArray(map) &&
    Object.keys(map).length <= 2 * MAX_USERS_PER_KIND &&
    Object.entries(map).every(([handle,id]) => VALID_HANDLE.test(handle) &&
      typeof id === "string" && VALID_ID.test(id)));
}
export function selectAccounts(handles, search="", filter="all", snapshot=null, kind) {
  const query = String(search).trim().replace(/^@/,"").toLowerCase();
  const allowed = ["all","blue","not-blue","unknown"];
  if (!allowed.includes(filter)) filter = "all";
  return handles.filter(handle => {
    if (!handle.includes(query)) return false;
    const verified = verificationFor(snapshot,handle,kind);
    return filter === "all" || (filter === "blue" && verified === true) ||
      (filter === "not-blue" && verified === false) ||
      (filter === "unknown" && verified === null);
  });
}
export function compareSnapshots(now, before) {
  if (!before || !now || now.owner !== before.owner) return null;
  // Do not compare partial observations as if they were full history.
  const partial=s=>s.reasons && !["following","followers"].every(k=>
    ["complete","bottom_observed"].includes(s.reasons[k]));
  if(partial(now)||partial(before))return null;
  const current=members(now,"followers"),past=members(before,"followers");
  const diff=compareMembers(current,past);
  return {
    newFollowers:diff.leftOnly.length,missingFollowers:diff.rightOnly.length,
    previousAt:before.importedAt,
    byStableId:current.every(x=>!!x.id)&&past.every(x=>!!x.id)
  };
}
export function snapshotIsCurrent(snapshot, now=Date.now()) {
  const time=Date.parse(snapshot?.importedAt || "");
  return Number.isFinite(time) && time<=now && now-time < 24*60*60*1000;
}

// Identity-based local relationship projection. No network access.
// Keep the source direction because the same handle can refer to different
// IDs in observations taken at different times.
export function directionForCategory(category) {
  return category==="iHaveNotFollowedBack"?"followers":"following";
}
function directionMap(snapshot,kind,field) {
  const directional=snapshot?.directional;
  return directional ? directional[kind]?.[field] : snapshot?.[field];
}
function own(map,key) {
  return map && Object.hasOwn(map,key)?map[key]:undefined;
}
export function accountIdFor(snapshot,handle,kind) {
  const id=own(directionMap(snapshot,kind,"ids"),handle);
  return typeof id==="string" && VALID_ID.test(id)?id:null;
}
export function accountProfileUrl(snapshot,handle,kind) {
  const id=accountIdFor(snapshot,handle,kind);
  if(id)return "https://x.com/i/user/"+id;
  if(!VALID_HANDLE.test(handle))throw Error("无效用户名");
  return "https://x.com/"+handle;
}
export function validDirectional(value) {
  if(value==null)return true;
  return typeof value==="object" && !Array.isArray(value) &&
    Object.keys(value).every(k=>["following","followers"].includes(k)) &&
    ["following","followers"].every(kind=>{
      const x=value[kind];
      return !!x && typeof x==="object" && !Array.isArray(x) &&
        validIds(x.ids) && validVerification(x.verification);
    });
}
function members(snapshot,kind) {
  const known=new Map(),unknown=new Map();
  for(const handle of snapshot?.[kind]||[]) {
    if(typeof handle!=="string"||!VALID_HANDLE.test(handle))continue;
    const id=accountIdFor(snapshot,handle,kind);
    const map=id?known:unknown;
    const key=id||handle;
    if(!map.has(key))map.set(key,{handle,id});
  }
  const knownHandles=new Set([...known.values()].map(x=>x.handle));
  return [...known.values(),...[...unknown.values()].filter(x=>!knownHandles.has(x.handle))];
}
// A name fallback is allowed only if at least one side lacks an ID.
// Matching is one-to-one, and known mismatching IDs never match by name.
function compareMembers(left,right) {
  const rightIds=new Map(),rightNames=new Map();
  right.forEach((x,i)=>{
    if(x.id)rightIds.set(x.id,i);
    if(!rightNames.has(x.handle))rightNames.set(x.handle,[]);
    rightNames.get(x.handle).push(i);
  });
  const used=new Set(),matched=new Set();
  left.forEach((x,i)=>{
    if(x.id && rightIds.has(x.id)){
      used.add(rightIds.get(x.id));matched.add(i);
    }
  });
  left.forEach((x,i)=>{
    if(matched.has(i))return;
    const candidates=(rightNames.get(x.handle)||[]).filter(j=>!used.has(j)&&(!x.id||!right[j].id));
    if(candidates.length===1){used.add(candidates[0]);matched.add(i);}
  });
  return {matched:left.filter((_,i)=>matched.has(i)),
    leftOnly:left.filter((_,i)=>!matched.has(i)),rightOnly:right.filter((_,i)=>!used.has(i))};
}
export function classifySnapshotRelationships(snapshot) {
  const d=compareMembers(members(snapshot,"following"),members(snapshot,"followers"));
  return {mutual:d.matched.map(x=>x.handle),notFollowingBack:d.leftOnly.map(x=>x.handle),
    iHaveNotFollowedBack:d.rightOnly.map(x=>x.handle)};
}
