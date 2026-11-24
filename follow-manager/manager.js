import {MAX_ARCHIVE_BYTES, MAX_ARCHIVE_USERS, normalizeHandle, parseArchiveText, mergeArchiveParts, classifyRelationships, profileUrl} from "./archive.js";
import {readSnapshot, readLatestSnapshot, saveSnapshot, removeSnapshot} from "./store.js";
import {groupArchiveFiles, appendArchiveFiles} from "./file-selection.js";
import {collectArchiveFilesFromDirectory, MAX_DIRECTORY_ENTRIES} from "./directory-import.js";

const $ = id => document.getElementById(id);
let pageSize = 50;
const kinds = ["notFollowingBack", "iHaveNotFollowedBack"];
const LAST_OWNER_KEY = "xrh-follow-archive-last-owner";
let restoring = true;
let importing = false;
let current = null;
let relationships = null;
let selectedKind = "notFollowingBack";
let page = 0;
const selectedFiles = {follower:[], following:[]};

function describeSelection(kind) {
  const files = selectedFiles[kind];
  const target = $(kind === "follower" ? "selected-follower" : "selected-following");
  const label = kind === "follower" ? "粉丝文件" : "关注文件";
  target.textContent = !files.length ? label + "：未选择" :
    label + "：" + files.length + " 个（" + files.map(file => file.name).join("、") + "）";
}

function refreshSelection() {
  describeSelection("follower");
  describeSelection("following");
}

// Folder import is the primary path. Manual JS selection is an optional fallback.
let directoryScan = null;
function scanControls(active) {
  const busy=active || importing || restoring;
  for (const id of ["choose-folder", "choose-files", "choose-folder-fallback", "clear-selection", "import-button", "owner", "same-account", "load-saved", "delete-saved", "close-import", "open-import"]) {
    $(id).disabled = busy;
  }
  $("cancel-scan").hidden = !active;
}
function clearSelection() {
  selectedFiles.follower=[];
  selectedFiles.following=[];
  $("same-account").checked=false;
  refreshSelection();
}
function openImport() {
  clearSelection();
  $("import-panel").hidden=false;
  $("close-import").hidden=!current;
  // Keep the last successfully imported result accessible until replacement succeeds.
  $("import-panel").scrollIntoView({block:"start",behavior:"auto"});
}
function rememberOwner(owner) {
  try {localStorage.setItem(LAST_OWNER_KEY,owner);} catch {}
}
function clearRememberedOwner(owner) {
  try {if(localStorage.getItem(LAST_OWNER_KEY)===owner)localStorage.removeItem(LAST_OWNER_KEY);} catch {}
}
async function acceptDirectory(entry) {
  if (directoryScan || $("import-button").disabled) return;
  const controller = new AbortController();
  directoryScan = controller;
  scanControls(true);
  feedback("正在定位 data 文件夹并查找粉丝、关注文件；不会读取媒体、私信或上传数据…");
  try {
    const files = await collectArchiveFilesFromDirectory(entry, {
      signal:controller.signal,
      onProgress:({scanned, found}) => feedback("正在扫描关注文件目录：" + scanned + " 项，找到 " + found + " 个候选文件…")
    });
    const groups = await groupArchiveFiles(files);
    if (!groups.follower.length || !groups.following.length) {
      throw new Error("文件夹缺少粉丝或关注名单，请确认选中的是完整的 X 归档及所有分片。");
    }
    if (controller.signal.aborted) throw new Error("已取消文件夹扫描。");
    selectedFiles.follower = groups.follower;
    selectedFiles.following = groups.following;
    $("same-account").checked=false;
    refreshSelection();
    feedback("已从文件夹找到粉丝 " + groups.follower.length + " 个分片、关注 " +
      groups.following.length + " 个分片。只读取了文件头用于识别；确认账号后点击「导入并分析」。");
  } catch (error) { reportError(error); }
  finally {
    directoryScan = null;
    scanControls(false);
  }
}

async function acceptFiles(fileList) {
  if (directoryScan || $("import-button").disabled) return;
  try {
    const next = await appendArchiveFiles(selectedFiles, fileList);
    selectedFiles.follower = next.follower;
    selectedFiles.following = next.following;
    $("same-account").checked=false;
    refreshSelection();
    const missing = ["follower", "following"].filter(kind => !selectedFiles[kind].length);
    feedback(missing.length ?
      "已添加文件，请继续补选" + (missing.includes("follower") ? "粉丝" : "关注") + "名单。" :
      "已选择两组文件。允许分次添加 part 分片；选择新的 part0 会重置对应类别，避免混入旧归档。");
  } catch (error) { reportError(error); }
}

$("choose-folder").addEventListener("click", async () => {
  if (directoryScan) return;
  if (typeof window.showDirectoryPicker !== "function") {
    $("choose-folder-fallback").hidden = false;
    feedback("此 Chrome 无法使用快速目录选择。请点击「兼容选择文件夹」，或直接拖入解压后的文件夹。");
    return;
  }
  let directory;
  try {
    // Must run directly from the click to retain transient user activation.
    directory = await window.showDirectoryPicker({mode:"read"});
  } catch (error) {
    if (error?.name === "AbortError") return;
    $("choose-folder-fallback").hidden = false;
    feedback("Chrome 未能打开快速目录选择；请用「兼容选择文件夹」或直接拖拽。", true);
    return;
  }
  await acceptDirectory(directory);
});
$("choose-folder-fallback").addEventListener("click", () => $("archive-folder-picker").click());
$("archive-folder-picker").addEventListener("change", event => {
  const all = [...event.target.files];
  event.target.value = "";
  // webkitdirectory is only a fallback: it eagerly enumerates the selected
  // directory in Chrome, so reject unreasonably large catalogs.
  if (all.length > MAX_DIRECTORY_ENTRIES) {
    feedback("兼容目录选择包含过多项目。请改为拖拽整个文件夹，以免浏览器处理全部媒体目录。", true);
    return;
  }
  const candidates = all.filter(file => {
    const parts = (file.webkitRelativePath || "").split("/");
    return parts.length >= 2 && parts[parts.length - 2].toLowerCase() === "data" &&
      /^(?:follower|following)(?:[._-][a-z0-9._-]+)?\.js$/i.test(file.name);
  });
  if (!candidates.length) { feedback("未找到 data/follower.js 或 data/following.js。", true); return; }
  void acceptDirectoryFromFiles(candidates);
});
async function acceptDirectoryFromFiles(files) {
  if (directoryScan || $("import-button").disabled) return;
  try {
    const groups = await groupArchiveFiles(files);
    if (!groups.follower.length || !groups.following.length) throw new Error("文件夹缺少粉丝或关注名单。");
    selectedFiles.follower = groups.follower;
    selectedFiles.following = groups.following;
    $("same-account").checked=false;
    refreshSelection();
    feedback("已从文件夹定位两组名单。确认账号后点击「导入并分析」。");
  } catch (error) { reportError(error); }
}
$("choose-files").addEventListener("click", () => $("archive-picker").click());
$("archive-picker").addEventListener("change", event => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length) void acceptFiles(files);
});
$("cancel-scan").addEventListener("click", () => directoryScan?.abort());
$("clear-selection").addEventListener("click", () => {
  clearSelection();
  feedback("已清空待导入文件；之前保存的本地快照不受影响。");
});

const dropzone = $("archive-dropzone");
let dragDepth = 0;
function isFileDrag(event) {
  return [...(event.dataTransfer?.types || [])].includes("Files");
}
dropzone.addEventListener("dragenter", event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth++;
  dropzone.classList.add("is-dragging");
});
dropzone.addEventListener("dragover", event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
});
dropzone.addEventListener("dragleave", event => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropzone.classList.remove("is-dragging");
});
dropzone.addEventListener("drop", event => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove("is-dragging");
  if (directoryScan) return;
  const transfer = event.dataTransfer;
  const items = [...(transfer?.items || [])].filter(item => item.kind === "file");
  // The legacy entry must be captured synchronously inside the drop event.
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const folders = entries.filter(entry => entry.isDirectory);
  if (folders.length) {
    if (entries.length !== 1 || folders.length !== 1) {
      feedback("请一次只拖入一个完整的归档文件夹。", true);
      return;
    }
    void acceptDirectory(folders[0]);
    return;
  }
  if (!entries.length && items.some(item => typeof item.getAsFileSystemHandle === "function")) {
    // Modern handles must also be requested before the drop event returns.
    const pending = items.map(item => item.getAsFileSystemHandle());
    void Promise.all(pending).then(handles => {
      const directories = handles.filter(handle => handle?.kind === "directory");
      if (directories.length) {
        if (handles.length !== 1 || directories.length !== 1) {
          feedback("请一次只拖入一个完整的归档文件夹。", true);
          return;
        }
        void acceptDirectory(directories[0]);
      } else {
        void acceptFiles([...(transfer?.files || [])]);
      }
    }).catch(reportError);
    return;
  }
  void acceptFiles([...(transfer?.files || [])]);
});
refreshSelection();

function feedback(message, error = false) {
  $("feedback").textContent = message;
  $("feedback").classList.toggle("error", error);
}
function reportError(error) {
  feedback(error instanceof Error ? error.message : "本地操作失败，请重试。", true);
}
function ownerValue() { return normalizeHandle($("owner").value); }
function chooseVisible(kind) {
  selectedKind = kind;
  page = 0;
  for (const button of document.querySelectorAll(".tab")) {
    button.setAttribute("aria-pressed", String(button.dataset.kind === kind));
  }
  renderList();
}
function filteredIds() {
  const text = $("filter-id").value.trim();
  const ids = relationships?.[selectedKind] || [];
  return text ? ids.filter(id => id.includes(text)) : ids;
}
function renderList() {
  if (!current || !relationships) return;
  const ids = filteredIds();
  const count = ids.length;
  const pages = Math.max(1, Math.ceil(count / pageSize));
  page = Math.max(0, Math.min(page, pages - 1));
  const fragment = document.createDocumentFragment();
  const visible = ids.slice(page * pageSize, (page + 1) * pageSize);
  for (const [index,id] of visible.entries()) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.setAttribute("role", "listitem");
    const identity=document.createElement("div");
    identity.className="result-identity";
    const position=document.createElement("span");
    position.className="result-index";
    position.textContent=String(page*pageSize+index+1);
    const name = document.createElement("strong");
    name.textContent = id;
    identity.append(position,name);
    const link = document.createElement("a");
    link.href = profileUrl(id);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "打开 X 主页 ↗";
    row.append(identity, link);
    fragment.append(row);
  }
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "此分类没有匹配的账号。";
    fragment.append(empty);
  }
  $("result-list").replaceChildren(fragment);
  $("result-count").textContent = "此分类共 " + count.toLocaleString("zh-CN") + " 个账号" +
    ($("filter-id").value.trim() ? "（已按数字 ID 筛选）" : "（按归档顺序展示）");
  $("page-info").textContent = (page + 1) + " / " + pages;
  $("page-prev").disabled = page === 0;
  $("page-next").disabled = page >= pages - 1;
  $("export-csv").disabled = count === 0;
}
function showSnapshot(snapshot) {
  current = snapshot;
  relationships = classifyRelationships(snapshot.followers, snapshot.following);
  $("owner").value="@"+snapshot.owner;
  rememberOwner(snapshot.owner);
  $("import-panel").hidden=true;
  $("close-import").hidden=false;
  clearSelection();
  $("results-panel").hidden = false;
  $("snapshot-owner").textContent = "@" + snapshot.owner;
  const imported = new Date(snapshot.importedAt);
  $("snapshot-time").textContent = "本地导入时间：" + (Number.isFinite(imported.getTime()) ? imported.toLocaleString("zh-CN") : "未知") +
    " · 粉丝 " + snapshot.followers.length.toLocaleString("zh-CN") +
    " · 正在关注 " + snapshot.following.length.toLocaleString("zh-CN") +
    " · 归档生成时间可能早于导入时间";
  $("count-not-following-back").textContent = relationships.notFollowingBack.length.toLocaleString("zh-CN");
  $("count-i-have-not-followed-back").textContent = relationships.iHaveNotFollowedBack.length.toLocaleString("zh-CN");
  $("filter-id").value = "";
  chooseVisible("notFollowingBack");
}
async function readGroup(fileList, kind) {
  const files = [...fileList];
  if (!files.length) throw new Error("请选择 " + kind + ".js 归档文件。");
  let bytes = 0;
  for (const file of files) {
    if (!/\.js$/i.test(file.name) || file.size > MAX_ARCHIVE_BYTES) {
      throw new Error("只能导入 .js 归档文件，且每个文件不超过 32 MB。");
    }
    bytes += file.size;
    if (bytes > MAX_ARCHIVE_BYTES * 4) throw new Error("所选归档分片总体积过大。");
  }
  const parts = await Promise.all(files.map(async file => parseArchiveText(await file.text(), kind)));
  return mergeArchiveParts(parts, kind);
}

$("archive-form").addEventListener("submit", async event => {
  event.preventDefault();
  const button = $("import-button");
  if (button.disabled) return;
  importing=true;
  scanControls(false);
  feedback("正在本地读取并分析归档，不会上传文件…");
  try {
    const owner = ownerValue();
    if (!$("same-account").checked) throw new Error("请先确认两组名单属于同一账号、同一份归档。");
    const [followers, following] = await Promise.all([
      readGroup(selectedFiles.follower, "follower"),
      readGroup(selectedFiles.following, "following")
    ]);
    if (followers.ids.length > MAX_ARCHIVE_USERS || following.ids.length > MAX_ARCHIVE_USERS) {
      throw new Error("账号列表超过支持上限。");
    }
    const snapshot = {owner, importedAt:new Date().toISOString(), followers:followers.ids, following:following.ids};
    await saveSnapshot(snapshot);
    showSnapshot(snapshot);
    feedback("已安全导入 @" + owner + " 的本地快照。合并分片：粉丝 " + followers.partCount +
      "，关注 " + following.partCount + "；去除重复 ID " + (followers.duplicates + following.duplicates) + " 个。");
  } catch (error) { reportError(error); }
  finally { importing=false;scanControls(false); }
});

$("load-saved").addEventListener("click", async () => {
  try {
    const owner = ownerValue();
    const snapshot = await readSnapshot(owner);
    if (!snapshot) { feedback("本机没有 @" + owner + " 的已保存快照。"); return; }
    showSnapshot(snapshot);
    feedback("已读取 @" + owner + " 的本地快照。再次导入可更新，不会后台自动刷新。");
  } catch (error) { reportError(error); }
});

$("delete-saved").addEventListener("click", async () => {
  try {
    const owner = ownerValue();
    if (!window.confirm("确认删除 @" + owner + " 在本机保存的粉丝和关注关系数据？")) return;
    await removeSnapshot(owner);
    clearRememberedOwner(owner);
    if (current?.owner === owner) {
      current = null;
      relationships = null;
      $("results-panel").hidden = true;
      $("result-list").replaceChildren();
      $("import-panel").hidden=false;
      $("close-import").hidden=true;
      clearSelection();
    }
    feedback("已清除 @" + owner + " 的本地快照。");
  } catch (error) { reportError(error); }
});

for (const button of document.querySelectorAll(".tab")) {
  button.addEventListener("click", () => { if (kinds.includes(button.dataset.kind)) chooseVisible(button.dataset.kind); });
}
$("filter-id").addEventListener("input", () => { page = 0; renderList(); });
$("page-size").addEventListener("change",()=>{pageSize=Number($("page-size").value);page=0;renderList();});
$("open-import").addEventListener("click",openImport);
$("close-import").addEventListener("click",()=>{if(current){clearSelection();$("owner").value="@"+current.owner;$("import-panel").hidden=true;}});
$("page-prev").addEventListener("click", () => { page--; renderList(); });
$("page-next").addEventListener("click", () => { page++; renderList(); });
$("export-csv").addEventListener("click", () => {
  if (!current || !relationships) return;
  const ids = filteredIds();
  if (!ids.length) return;
  const csv = "\uFEFFaccount_id,profile_url,category\r\n" + ids.map(id =>
    id + "," + profileUrl(id) + "," + selectedKind).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], {type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "xrh-" + current.owner + "-" + selectedKind + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
});

async function restoreLocalResult() {
  scanControls(false);
  feedback("正在读取本地结果…");
  try {
    let preferred;
    try {preferred=localStorage.getItem(LAST_OWNER_KEY);} catch {}
    let saved=preferred && /^[a-z0-9_]{1,15}$/.test(preferred)?await readSnapshot(preferred):null;
    if(!saved)saved=await readLatestSnapshot();
    if(saved)showSnapshot(saved);
    else feedback("选择归档文件夹，即可开始分析。");
  } catch(error) { reportError(error); }
  finally { restoring=false;scanControls(false); }
}
void restoreLocalResult();
