// Pure local model helpers for relationship list filtering and history.
// Unknown verification is distinct from confirmed non-blue-verified.
export const MAX_USERS_PER_KIND = 30000;
const VALID_HANDLE = /^[a-z0-9_]{1,15}$/;
const VALID_ID = /^[1-9]\d{0,19}$/;
export function verificationFor(snapshot, handle) {
  const result = snapshot?.verification?.[handle];
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
export function selectAccounts(handles, search="", filter="all", snapshot=null) {
  const query = String(search).trim().replace(/^@/,"").toLowerCase();
  const allowed = ["all","blue","not-blue","unknown"];
  if (!allowed.includes(filter)) filter = "all";
  return handles.filter(handle => {
    if (!handle.includes(query)) return false;
    const verified = verificationFor(snapshot,handle);
    return filter === "all" || (filter === "blue" && verified === true) ||
      (filter === "not-blue" && verified === false) ||
      (filter === "unknown" && verified === null);
  });
}
export function compareSnapshots(now, before) {
  if (!before || !now || now.owner !== before.owner) return null;
  // The web client supplies stable numeric IDs when present. Archive/DOM
  // snapshots may have only usernames, so do not claim definite unfollows.
  function identifiers(snapshot,kind) {
    return new Set((snapshot[kind] || []).map(handle =>
      snapshot.ids?.[handle] || "handle:"+handle));
  }
  const current = identifiers(now,"followers");
  const past = identifiers(before,"followers");
  const newFollowers = [...current].filter(x => !past.has(x)).length;
  const missingFollowers = [...past].filter(x => !current.has(x)).length;
  return {
    newFollowers, missingFollowers,
    previousAt:before.importedAt,
    byStableId: !!now.ids && !!before.ids &&
      (now.followers || []).every(x=>now.ids[x]) &&
      (before.followers || []).every(x=>before.ids[x])
  };
}
export function snapshotIsCurrent(snapshot, now=Date.now()) {
  const time=Date.parse(snapshot?.importedAt || "");
  return Number.isFinite(time) && time<=now && now-time < 24*60*60*1000;
}
