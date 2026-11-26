// Official X archive parser. Uploaded .js files are treated as inert text, never executed.
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_ARCHIVE_USERS = 250_000;
const VALID_ID = /^[1-9][0-9]{0,19}$/;

export function normalizeHandle(value) {
  const handle = String(value ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9_]{1,15}$/.test(handle)) {
    throw new Error("请输入有效的 X 用户名（1–15 位字母、数字或下划线）。");
  }
  return handle;
}

export function parseArchiveText(text, kind) {
  if (kind !== "follower" && kind !== "following") throw new Error("未知的归档名单类型。");
  if (typeof text !== "string" || text.length > MAX_ARCHIVE_BYTES) {
    throw new Error("归档文件过大或格式无效。每个文件不能超过 32 MB。");
  }
  const source = text.replace(/^\uFEFF/, "").trim();
  const match = /^window\.YTD\.(follower|following)\.part([0-9]+)\s*=\s*(\[[\s\S]*\])\s*;?$/.exec(source);
  if (!match || match[1] !== kind) {
    throw new Error("归档格式不匹配。请从 X 官方 ZIP 中选择正确的 " + kind + ".js 文件。");
  }
  const partNumber = Number(match[2]);
  if (!Number.isSafeInteger(partNumber) || partNumber > 999) {
    throw new Error("归档分片编号无效。");
  }
  let records;
  try { records = JSON.parse(match[3]); }
  catch { throw new Error("归档内容不是有效 JSON，已安全拒绝执行其中的 JavaScript。"); }
  if (!Array.isArray(records) || records.length > MAX_ARCHIVE_USERS) {
    throw new Error("归档名单不是有效数组，或者超出单文件 25 万账号上限。");
  }
  const ids = [];
  let duplicates = 0;
  const seen = new Set();
  for (let i = 0; i < records.length; i++) {
    const id = records[i]?.[kind]?.accountId;
    // Snowflake IDs are strings, never coerce JSON numbers (precision can be lost).
    if (typeof id !== "string" || !VALID_ID.test(id)) {
      throw new Error(kind + " 文件第 " + (i + 1) + " 条的账号 ID 无效，已停止导入。");
    }
    if (seen.has(id)) { duplicates++; continue; }
    seen.add(id);
    ids.push(id);
  }
  return {kind, partNumber, ids, duplicates};
}

export function mergeArchiveParts(parts, kind) {
  if (!Array.isArray(parts) || !parts.length || !["follower", "following"].includes(kind)) {
    throw new Error("至少选择一个有效的归档文件。");
  }
  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  let duplicates = 0;
  const seen = new Set();
  const ids = [];
  for (let index = 0; index < ordered.length; index++) {
    const part = ordered[index];
    if (part?.kind !== kind || part.partNumber !== index || !Array.isArray(part.ids)) {
      throw new Error("归档分片缺失、重复或类型不一致；请选齐 part0 开始的所有文件。");
    }
    duplicates += part.duplicates || 0;
    for (const id of part.ids) {
      if (typeof id !== "string" || !VALID_ID.test(id)) throw new Error("归档中有无效的账号 ID。");
      if (seen.has(id)) { duplicates++; continue; }
      seen.add(id);
      ids.push(id);
      if (ids.length > MAX_ARCHIVE_USERS) throw new Error("总名单超过 25 万账号上限。");
    }
  }
  return {ids, duplicates, partCount:ordered.length};
}

export function classifyRelationships(followers, following) {
  if (!Array.isArray(followers) || !Array.isArray(following)) throw new TypeError("名单必须是数组。");
  const followerIds = new Set(followers);
  const followingIds = new Set(following);
  return {
    mutual: [...followingIds].filter(id => followerIds.has(id)),
    notFollowingBack: [...followingIds].filter(id => !followerIds.has(id)),
    iHaveNotFollowedBack: [...followerIds].filter(id => !followingIds.has(id))
  };
}

export function profileUrl(id) {
  if (typeof id !== "string" || !VALID_ID.test(id)) throw new Error("无效用户 ID。");
  return "https://x.com/i/user/" + id;
}


// Validate the complete selection before reading any content. Read one file
// at a time to avoid retaining several large decoded JSON strings together.
export async function readArchiveGroup(fileList, kind, onProgress=()=>{}) {
  if (!["follower","following"].includes(kind)) throw new Error("未知的归档名单类型。");
  const files=[...fileList];
  if (!files.length) throw new Error("请选择 "+kind+".js 归档文件。");
  if (files.length>16) throw new Error("单次最多选择 16 个归档分片文件。");
  let bytes=0;
  for (const file of files) {
    if (!file || !/\.js$/i.test(file.name) || !Number.isFinite(file.size) ||
        file.size<=0 || file.size>MAX_ARCHIVE_BYTES || typeof file.text!=="function") {
      throw new Error("只能导入 .js 归档文件，且每个文件不超过 32 MB。");
    }
    bytes+=file.size;
    if (bytes>MAX_ARCHIVE_BYTES*4) throw new Error("所选归档分片总体积过大。");
  }
  const parts=[];
  for(let i=0;i<files.length;i++){
    onProgress({kind,completed:i,total:files.length,name:files[i].name});
    parts.push(parseArchiveText(await files[i].text(),kind));
  }
  onProgress({kind,completed:files.length,total:files.length});
  return mergeArchiveParts(parts,kind);
}
