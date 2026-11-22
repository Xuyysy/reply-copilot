// Drag/drop and file-pickers only select local files. No archive content is executed or uploaded.
import {MAX_ARCHIVE_BYTES} from "./archive.js";

const MAX_SELECTED_FILES = 16;
const MAX_GROUP_BYTES = MAX_ARCHIVE_BYTES * 4;

export function detectArchiveKind(header) {
  const match = /^window\.YTD\.(follower|following)\.part([0-9]+)\s*=/.exec(
    String(header ?? "").replace(/^\uFEFF/, "").trimStart()
  );
  if (!match || !Number.isSafeInteger(Number(match[2])) || Number(match[2]) > 999) {
    throw new Error("无法识别归档文件类型。请只选择 X 官方解压后的 follower.js / following.js（含分片）。");
  }
  return match[1];
}

export async function groupArchiveFiles(fileList) {
  const files = [...fileList];
  if (!files.length) throw new Error("请先选择或拖入归档文件。");
  if (files.length > MAX_SELECTED_FILES) throw new Error("单次最多选择 16 个归档分片文件。");
  const groups = {follower:[], following:[]};
  const sizes = {follower:0, following:0};
  for (const file of files) {
    if (!file || !/\.js$/i.test(file.name) || !Number.isFinite(file.size) ||
        file.size <= 0 || file.size > MAX_ARCHIVE_BYTES ||
        typeof file.slice !== "function") {
      throw new Error("只支持解压后的 .js 文件，每个文件须大于 0 且不超过 32 MB；不支持 ZIP。");
    }
    const header = await file.slice(0, 1024).text();
    const kind = detectArchiveKind(header);
    sizes[kind] += file.size;
    if (sizes[kind] > MAX_GROUP_BYTES) throw new Error("同一类归档分片总体积超过 128 MB。");
    groups[kind].push(file);
  }
  return groups;
}
