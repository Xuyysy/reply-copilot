// Read only follower/following candidates from an explicitly chosen X archive directory.
// Never descend into media folders, evaluate archive JavaScript, or upload content.
export const MAX_DIRECTORY_ENTRIES = 4096;
export const MAX_DIRECTORY_FILES = 16;
const TARGET_NAME = /^(?:follower|following)(?:[._-][a-z0-9._-]+)?\.js$/i;

function isDirectory(entry) {
  return entry?.kind === "directory" || entry?.isDirectory === true;
}
function isFile(entry) {
  return entry?.kind === "file" || entry?.isFile === true;
}
function notFound(error) {
  return error?.name === "NotFoundError";
}
function checkCanceled(signal) {
  if (signal?.aborted) throw new Error("已取消文件夹扫描。");
}

// Chrome's legacy drag/drop API returns at most ~100 items per readEntries call.
async function* children(directory) {
  if (typeof directory.values === "function") {
    for await (const entry of directory.values()) yield entry;
    return;
  }
  if (typeof directory.createReader !== "function") throw new Error("浏览器不支持读取该文件夹，请使用手动选择文件。");
  const reader = directory.createReader();
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) return;
    for (const entry of batch) yield entry;
  }
}
async function directFile(entry) {
  if (typeof entry.getFile === "function") return entry.getFile();
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function dataDirectory(root, signal) {
  if (String(root.name).toLowerCase() === "data") return root;
  if (typeof root.getDirectoryHandle === "function") {
    try {
      return await root.getDirectoryHandle("data", {create:false});
    } catch (error) {
      if (!notFound(error)) throw error;
    }
  }
  // Legacy directory entries have no direct child lookup. Scan names only,
  // never enter any child directory except one literally called data.
  let visited = 0;
  for await (const entry of children(root)) {
    checkCanceled(signal);
    if (++visited > MAX_DIRECTORY_ENTRIES) throw new Error("归档根目录项目过多，请直接选择其中的 data 文件夹。");
    if (isDirectory(entry) && entry.name.toLowerCase() === "data") return entry;
  }
  // The user may already have selected a folder containing both JS files.
  return root;
}

export async function collectArchiveFilesFromDirectory(root, {signal, onProgress} = {}) {
  if (!isDirectory(root)) throw new Error("请拖入或选择解压后的 X 归档文件夹，而不是 ZIP。");
  checkCanceled(signal);
  const directory = await dataDirectory(root, signal);
  const files = [];
  let scanned = 0;
  for await (const entry of children(directory)) {
    checkCanceled(signal);
    if (++scanned > MAX_DIRECTORY_ENTRIES) {
      throw new Error("data 文件夹项目过多，已停止扫描；可以手动选择 follower.js 和 following.js。");
    }
    // Only examine direct children. Never recurse into images, media, or messages.
    if (!isFile(entry) || !TARGET_NAME.test(entry.name)) continue;
    if (files.length >= MAX_DIRECTORY_FILES) throw new Error("关注名单分片超过 16 个，请手动核实归档。");
    files.push(await directFile(entry));
    if (typeof onProgress === "function") onProgress({scanned, found:files.length});
  }
  if (!files.length) throw new Error("找不到 follower.js / following.js；请选择 X 解压后的归档根目录或 data 文件夹。");
  return files;
}
