// Drag/drop and file-pickers only select local files. No archive content is executed or uploaded.
import {MAX_ARCHIVE_BYTES} from "./archive.js";

const MAX_SELECTED_FILES = 16;
const MAX_GROUP_BYTES = MAX_ARCHIVE_BYTES * 4;

export function detectArchiveHeader(header) {
  const match = /^window\.YTD\.(follower|following)\.part([0-9]+)\s*=/.exec(
    String(header ?? "").replace(/^\uFEFF/, "").trimStart()
  );
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > 999) {
    throw new Error("无法识别归档文件类型。请只选择 X 官方解压后的 follower.js / following.js（含分片）。");
  }
  return {kind:match[1], partNumber:Number(match[2])};
}
export function detectArchiveKind(header) {
  return detectArchiveHeader(header).kind;
}

export async function groupArchiveFiles(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error("请先选择或拖入归档文件。");
  if (files.length > MAX_SELECTED_FILES) throw new Error("单次最多选择 16 个归档分片文件。");
  const groups = {follower:[], following:[]};
  const sizes = {follower:0, following:0};
  const parts = {follower:new Set(), following:new Set()};
  for (const file of files) {
    if (!file || !/\.js$/i.test(file.name) || !Number.isFinite(file.size) ||
        file.size <= 0 || file.size > MAX_ARCHIVE_BYTES ||
        typeof file.slice !== "function") {
      throw new Error("只支持解压后的 .js 文件，每个文件须大于 0 且不超过 32 MB；不支持 ZIP。");
    }
    const header = await file.slice(0, 1024).text();
    const {kind, partNumber} = detectArchiveHeader(header);
    if (parts[kind].has(partNumber)) throw new Error("存在重复的归档分片 part" + partNumber + "，已取消本次选择。");
    parts[kind].add(partNumber);
    sizes[kind] += file.size;
    if (sizes[kind] > MAX_GROUP_BYTES) throw new Error("同一类归档分片总体积超过 128 MB。");
    groups[kind].push(file);
  }
  return groups;
}

/**
 * Manual additions keep previously selected parts, including part1 selected on a
 * later click. Selecting a new part0 starts a fresh group, avoiding stale part1
 * from a different archive; selecting a matching partN replaces only that part.
 * Validate the entire resulting selection atomically before returning it.
 */
export async function appendArchiveFiles(previous, incoming) {
  const fresh = await groupArchiveFiles(incoming);
  const combined = [];
  for (const kind of ["follower", "following"]) {
    const newParts = await Promise.all(fresh[kind].map(async file =>
      [detectArchiveHeader(await file.slice(0, 1024).text()).partNumber, file]
    ));
    const retained = newParts.some(([number]) => number === 0) ? [] :
      await Promise.all((previous?.[kind] || []).map(async file =>
        [detectArchiveHeader(await file.slice(0, 1024).text()).partNumber, file]
      ));
    const byPart = new Map([...retained, ...newParts]);
    combined.push(...[...byPart.entries()].sort((a, b) => a[0] - b[0]).map(([, file]) => file));
  }
  return groupArchiveFiles(combined);
}
