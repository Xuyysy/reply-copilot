import {MAX_ARCHIVE_BYTES, MAX_ARCHIVE_USERS, normalizeHandle, parseArchiveText, mergeArchiveParts, classifyRelationships, profileUrl} from "./archive.js";
import {readSnapshot, saveSnapshot, removeSnapshot} from "./store.js";
import {groupArchiveFiles} from "./file-selection.js";

const $ = id => document.getElementById(id);
const PAGE_SIZE = 50;
const kinds = ["notFollowingBack", "iHaveNotFollowedBack", "mutual"];
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

// Both the dropzone and browse controls use the same validation and selections.
async function acceptFiles(fileList, expectedKind = null) {
  if ($("import-button").disabled) return;
  try {
    const groups = await groupArchiveFiles(fileList);
    if (expectedKind && groups[expectedKind === "follower" ? "following" : "follower"].length) {
      throw new Error("文件类型与选择框不匹配。请将粉丝文件放入粉丝框，关注文件放入关注框。");
    }
    for (const kind of ["follower", "following"]) {
      if (groups[kind].length) selectedFiles[kind] = groups[kind];
    }
    refreshSelection();
    const pending = ["follower", "following"].filter(kind => !selectedFiles[kind].length);
    feedback(pending.length ?
      "已识别导入文件，还需要选择" + (pending.includes("follower") ? "粉丝" : "关注") + "名单。":
      "已选择两组归档文件，确认属于同一份账号归档后点击「导入并分析」。单独替换某一组时，另一组沿用之前已选文件。");
  } catch (error) { reportError(error); }
}

$("choose-files").addEventListener("click", () => $("archive-picker").click());
$("archive-picker").addEventListener("change", event => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.length) void acceptFiles(files);
});
for (const [kind, inputId] of [["follower","follower-files"], ["following","following-files"]]) {
  $(inputId).addEventListener("change", event => {
    const files = [...event.target.files];
    event.target.value = "";
    if (files.length) void acceptFiles(files, kind);
  });
}
$("clear-selection").addEventListener("click", () => {
  selectedFiles.follower = [];
  selectedFiles.following = [];
  refreshSelection();
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
  const files = [...(event.dataTransfer?.files || [])];
  void acceptFiles(files);
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
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const fragment = document.createDocumentFragment();
  const visible = ids.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  for (const id of visible) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.setAttribute("role", "listitem");
    const name = document.createElement("strong");
    name.textContent = "用户 ID " + id;
    const link = document.createElement("a");
    link.href = profileUrl(id);
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "打开 X 主页 ↗";
    row.append(name, link);
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
  $("results-panel").hidden = false;
  $("snapshot-owner").textContent = "@" + snapshot.owner;
  const imported = new Date(snapshot.importedAt);
  $("snapshot-time").textContent = "本地导入时间：" + (Number.isFinite(imported.getTime()) ? imported.toLocaleString("zh-CN") : "未知") +
    " · 粉丝 " + snapshot.followers.length.toLocaleString("zh-CN") +
    " · 正在关注 " + snapshot.following.length.toLocaleString("zh-CN") +
    " · 归档生成时间可能早于导入时间";
  $("count-mutual").textContent = relationships.mutual.length.toLocaleString("zh-CN");
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
  button.disabled = true;
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
  finally { button.disabled = false; }
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
    if (current?.owner === owner) {
      current = null;
      relationships = null;
      $("results-panel").hidden = true;
      $("result-list").replaceChildren();
    }
    feedback("已清除 @" + owner + " 的本地快照。");
  } catch (error) { reportError(error); }
});

for (const button of document.querySelectorAll(".tab")) {
  button.addEventListener("click", () => { if (kinds.includes(button.dataset.kind)) chooseVisible(button.dataset.kind); });
}
$("filter-id").addEventListener("input", () => { page = 0; renderList(); });
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
