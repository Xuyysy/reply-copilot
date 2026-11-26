// Local archive comparisons only. Import order is not capture chronology.
import {MAX_ARCHIVE_USERS, normalizeHandle} from "./archive.js";
const ID = /^[1-9][0-9]{0,19}$/;
export const MAX_HISTORY = 5;
function validIds(ids) {
  return Array.isArray(ids) && ids.length <= MAX_ARCHIVE_USERS && ids.every(id => typeof id === "string" && ID.test(id));
}
function validTime(value) { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function validSnapshot(s, owner) {
  return s?.owner === owner && validTime(s.importedAt) && validIds(s.followers) && validIds(s.following);
}
function delta(before, after) {
  let added = 0, removed = 0;
  for (const id of after) if (!before.has(id)) added++;
  for (const id of before) if (!after.has(id)) removed++;
  return {added, removed};
}
function mutual(followers, following) {
  return new Set([...following].filter(id => followers.has(id)));
}
const validDelta = d => d && [d.added,d.removed].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=MAX_ARCHIVE_USERS);
function validHistory(h) {
  return h && validTime(h.previousImportedAt) && validTime(h.importedAt) &&
    ["followers","following","mutual"].every(key=>validDelta(h[key]));
}
export function mergeArchiveSnapshot(previous, next) {
  const owner = normalizeHandle(next?.owner);
  if (!validSnapshot(next,owner)) throw new Error("归档快照无效。");
  const followers = new Set(next.followers), following = new Set(next.following);
  const history = previous?.owner === owner && Array.isArray(previous.history)
    ? previous.history.filter(validHistory).slice(0,MAX_HISTORY) : [];
  if (validSnapshot(previous,owner)) {
    const pf = new Set(previous.followers), pg = new Set(previous.following);
    const f=delta(pf,followers), g=delta(pg,following);
    if (f.added || f.removed || g.added || g.removed) {
      history.unshift({previousImportedAt:previous.importedAt,importedAt:next.importedAt,
        followers:f,following:g,mutual:delta(mutual(pf,pg),mutual(followers,following))});
    }
  }
  return {owner, importedAt:next.importedAt, followers:[...followers], following:[...following],
    source:"official_archive", completeness:"user_confirmed_archive", history:history.slice(0,MAX_HISTORY)};
}
