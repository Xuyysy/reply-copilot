import {normalizeHandle, classifyRelationships} from "./archive.js";
import {saveWebSnapshot, readWebSnapshot, removeWebSnapshot} from "./web-scan-store.js";

const $ = id => document.getElementById(id);
const KINDS = ["mutual","notFollowingBack","iHaveNotFollowedBack"];
// Following and followers are read sequentially from a temporary inactive X tab.
const PAGE_SIZE = 50;
const MAX_HANDLES = 3000;
const REASON = {
  bottom_observed:"本轮已完成，覆盖范围未验证",
  limit:"达到单轮上限，结果可能不完整",
  timeout:"本轮用时较长，未能完成",
  page_changed:"后台 X 页面已离开列表",
  page_unavailable:"暂时无法读取 X 关注列表",
  page_error:"整理数据时遇到错误",
  cancelled:"已停止",
  empty:"没有找到账号，请检查 X 是否登录",
};
let running = null;
let snapshot = null;
let relationships = null;
let selectedKind = "mutual";
let currentPage = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function feedback(text, error=false) {
  $("web-status").textContent = text;
  $("web-status").classList.toggle("error",error);
}
function fail(error) {
  feedback(error instanceof Error ? error.message : "分析未能完成，请检查 X 是否已登录后重试。",true);
}
function elapsedLabel(ms) {
  const total = Math.max(0,Math.floor(ms / 1000));
  return "已用时间 " + String(Math.floor(total / 60)).padStart(2,"0") + ":" + String(total % 60).padStart(2,"0");
}
function updateElapsed(job) {
  $("web-elapsed").textContent = elapsedLabel(Date.now() - job.startedAt);
}
async function closeTemporaryTab(job) {
  if (!Number.isSafeInteger(job.tabId)) return;
  const tabId = job.tabId;
  job.tabId = null;
  try { await chrome.tabs.remove(tabId); } catch {}
}
function owner() {
  const value = normalizeHandle($("web-owner").value);
  if (["home","explore","search","settings","messages","notifications"].includes(value)) {
    throw new Error("请输入自己的 X 用户名，而不是 X 页面路径。");
  }
  return value;
}
function stageName(kind) { return kind === "following" ? "正在关注" : "粉丝"; }
function setStatus(kind,count,label) {
  $(kind === "following" ? "web-following-count" : "web-followers-count").textContent =
    Number.isSafeInteger(count) ? count.toLocaleString("zh-CN") : "—";
  $(kind === "following" ? "web-following-state" : "web-followers-state").textContent = label;
}
function setBusy(busy) {
  $("web-start").disabled = busy;
  $("web-cancel").disabled = !busy;
  $("web-load").disabled = busy;
  $("web-clear").disabled = busy;
  $("web-owner").disabled = busy;
  $("web-loading").hidden = !busy;
  if (busy) $("web-loading-title").textContent = "正在整理关注关系…";
}
function validHandles(handles) {
  return Array.isArray(handles) && handles.length <= MAX_HANDLES &&
    handles.every(x => typeof x === "string" && /^[a-z0-9_]{1,15}$/.test(x));
}
function validateSnapshot(value) {
  return value && typeof value === "object" &&
    typeof value.owner === "string" && /^[a-z0-9_]{1,15}$/.test(value.owner) &&
    validHandles(value.followers) && validHandles(value.following) &&
    value.reasons && typeof value.reasons.following === "string" &&
    typeof value.reasons.followers === "string";
}

chrome.runtime.onMessage.addListener((message,sender) => {
  const job = running;
  if (!job || !job.pending || sender.id !== chrome.runtime.id || sender.tab?.id !== job.tabId ||
      message?.scanId !== job.scanId || message?.kind !== job.kind) return;
  if (message.type === "XRH_FOLLOW_WEB_PROGRESS") {
    if (!Number.isSafeInteger(message.count) || message.count < 0 || message.count > MAX_HANDLES) return;
    setStatus(job.kind,message.count,"正在整理…");
    $("web-loading-title").textContent = "正在整理「" + stageName(job.kind) + "」";
    feedback("已读取 " + message.count + " 个「" + stageName(job.kind) + "」账号，正在继续…");
  } else if (message.type === "XRH_FOLLOW_WEB_DONE") {
    if (!validHandles(message.handles) || typeof message.reason !== "string" ||
        !Object.hasOwn(REASON,message.reason)) {
      job.pending.reject(new Error("扫描结果格式不符合安全要求，已拒绝导入。"));
      return;
    }
    job.pending.resolve({handles:[...new Set(message.handles)],reason:message.reason});
  }
});

async function waitReady(job) {
  const start = Date.now();
  while (Date.now() - start < 45_000) {
    if (job.cancelled) throw new Error("已停止网页扫描。");
    try {
      const check = await chrome.tabs.sendMessage(job.tabId,{type:"XRH_FOLLOW_WEB_PING"});
      if (check?.ok && check.route?.owner === job.owner && check.route.kind === job.kind) return;
    } catch {
      // X may still be navigating or loading the extension's content scripts.
    }
    await sleep(950);
  }
  throw new Error("无法连接 X 的后台列表。请确认已登录 X，稍后重试。");
}
async function stage(job,kind,first) {
  job.kind = kind;
  job.scanId = crypto.randomUUID();
  job.pending = null;
  setStatus(kind,null,"正在准备…");
  $("web-loading-title").textContent = "正在整理「" + stageName(kind) + "」";
  feedback("正在后台读取「" + stageName(kind) + "」的数据…");
  if (!first) {
    await chrome.tabs.update(job.tabId,{
      url:"https://x.com/" + job.owner + "/" + kind,
    });
  }
  await waitReady(job);
  if (job.cancelled) throw new Error("已停止网页扫描。");
  setStatus(kind,0,"开始读取网页…");
  const scanId = job.scanId;
  return new Promise((resolve,reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("网页扫描未在规定时间内结束，已停止等待。")),
      5 * 60 * 1000);
    function finish(error,value) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (job.pending?.id === scanId) job.pending = null;
      if (error) reject(error); else resolve(value);
    }
    job.pending = {
      id:scanId,
      resolve:value => finish(null,value),
      reject:error => finish(error),
    };
    chrome.tabs.sendMessage(job.tabId,{
      type:"XRH_FOLLOW_WEB_START", scanId, owner:job.owner, kind,
    }).then(response => {
      if (!response?.ok) finish(new Error(response?.error || "无法开始扫描 X 页面。"));
    }).catch(error => finish(new Error("无法连接 X 页面扫描器：" + (error?.message || "未知错误"))));
  });
}
function renderList() {
  if (!relationships) return;
  const search = $("web-filter").value.trim().replace(/^@/,"").toLowerCase();
  const items = relationships[selectedKind].filter(handle => handle.includes(search));
  const pageCount = Math.max(1,Math.ceil(items.length / PAGE_SIZE));
  currentPage = Math.max(0,Math.min(currentPage,pageCount-1));
  const fragment = document.createDocumentFragment();
  for (const handle of items.slice(currentPage * PAGE_SIZE,(currentPage+1)*PAGE_SIZE)) {
    const row = document.createElement("div");
    row.className = "result-row";
    row.setAttribute("role","listitem");
    const label = document.createElement("strong");
    label.textContent = "@" + handle;
    const link = document.createElement("a");
    link.href = "https://x.com/" + handle;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "打开 X 主页 ↗";
    row.append(label,link);
    fragment.append(row);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配的网页观察记录。";
    fragment.append(empty);
  }
  $("web-result-list").replaceChildren(fragment);
  $("web-result-count").textContent = "当前分类共 " + items.length + " 条观察记录" +
    (search ? "（已筛选）" : "（结果可能不完整）");
  $("web-page-info").textContent = (currentPage+1) + " / " + pageCount;
  $("web-prev").disabled = currentPage === 0;
  $("web-next").disabled = currentPage === pageCount - 1;
  $("web-export").disabled = items.length === 0;
}
function renderSnapshot(data,localSaved=false) {
  if (!validateSnapshot(data)) throw new Error("本地网页扫描数据格式不正确。");
  snapshot = data;
  relationships = classifyRelationships(data.followers,data.following);
  $("web-results").hidden = false;
  $("web-mutual").textContent = relationships.mutual.length.toLocaleString("zh-CN");
  $("web-not-following-back").textContent = relationships.notFollowingBack.length.toLocaleString("zh-CN");
  $("web-i-not-followed-back").textContent = relationships.iHaveNotFollowedBack.length.toLocaleString("zh-CN");
  const imported = new Date(data.importedAt);
  const time = Number.isFinite(imported.getTime()) ? imported.toLocaleString("zh-CN") : "时间未知";
  const ended = data.reasons.following === "bottom_observed" && data.reasons.followers === "bottom_observed";
  $("web-result-badge").textContent = ended ? "本次分析完成" : "部分结果";
  $("web-snapshot-meta").textContent = "@" + data.owner + " · " + time +
    " · 我关注 " + data.following.length + " 人 · 关注我的人 " + data.followers.length +
    " 人 · " + (localSaved ? "已保存到本机" : "本次结果") +
    (ended ? "" : " · 本次数据可能不完整");
  selectedKind = "mutual";
  currentPage = 0;
  $("web-filter").value = "";
  for (const button of document.querySelectorAll("[data-web-kind]")) {
    button.setAttribute("aria-pressed",String(button.dataset.webKind === selectedKind));
  }
  renderList();
}
async function start() {
  if (running) return;
  let account;
  try { account = owner(); } catch(error) { fail(error); return; }
  const job = {owner:account,tabId:null,cancelled:false,kind:null,scanId:null,pending:null,startedAt:Date.now(),timer:null};
  running = job;
  setBusy(true);
  updateElapsed(job);
  job.timer = setInterval(() => { if (running === job) updateElapsed(job); }, 1000);
  setStatus("following",null,"等待开始");
  setStatus("followers",null,"等待开始");
  $("web-results").hidden = true;
  snapshot = null;
  relationships = null;
  try {
    // An inactive tab preserves the user's current page. It still exists in
    // Chrome's tab strip and can be throttled/frozen by the browser.
    const tab = await chrome.tabs.create({url:"https://x.com/"+account+"/following",active:false});
    if (!Number.isSafeInteger(tab?.id)) throw new Error("Chrome 无法创建后台数据标签页。");
    job.tabId = tab.id;
    const following = await stage(job,"following",true);
    if (job.cancelled || following.reason === "cancelled") throw new Error("已停止网页扫描。");
    setStatus("following",following.handles.length,REASON[following.reason]);
    if (["empty","page_changed","page_unavailable","page_error"].includes(following.reason)) {
      throw new Error("我关注的人： " + REASON[following.reason] + "。原有结果未被覆盖。");
    }
    const followers = await stage(job,"followers",false);
    if (job.cancelled || followers.reason === "cancelled") throw new Error("已停止网页扫描。");
    setStatus("followers",followers.handles.length,REASON[followers.reason]);
    if (["empty","page_changed","page_unavailable","page_error"].includes(followers.reason)) {
      throw new Error("关注我的人： " + REASON[followers.reason] + "。原有结果未被覆盖。");
    }
    const data = {
      owner:account,source:"dom_scan", importedAt:new Date().toISOString(),
      following:following.handles,followers:followers.handles,
      reasons:{following:following.reason,followers:followers.reason},
    };
    const observedEnds = following.reason === "bottom_observed" && followers.reason === "bottom_observed";
    if (observedEnds) await saveWebSnapshot(data);
    renderSnapshot(data,observedEnds);
    feedback(observedEnds ?
      "已整理完成，并在本机保存。结果基于本次获取到的账号。" :
      "已显示本次部分结果，原来保存的记录未被覆盖。",
      !observedEnds);
  } catch (error) { fail(error); }
  finally {
    clearInterval(job.timer);
    updateElapsed(job);
    await closeTemporaryTab(job);
    if (running === job) running = null;
    setBusy(false);
  }
}
function cancel() {
  if (!running) return;
  const job = running;
  job.cancelled = true;
  feedback("正在停止分析…");
  if (job.tabId && job.scanId) {
    void chrome.tabs.sendMessage(job.tabId,{type:"XRH_FOLLOW_WEB_CANCEL",scanId:job.scanId}).catch(()=>{});
  }
  job.pending?.reject(new Error("已停止，本次没有覆盖之前的记录。"));
}
$("web-start").addEventListener("click",() => { void start(); });
$("web-cancel").addEventListener("click",cancel);
$("web-load").addEventListener("click",async() => {
  try {
    const account = owner();
    const data = await readWebSnapshot(account);
    if (!data) {feedback("本机没有 @" + account + " 的网页扫描快照。");return;}
    if (data.owner !== account) throw new Error("本地快照账号不匹配。");
    renderSnapshot(data,true);
    feedback("已读取 @" + account + " 上次保存在本机的结果。");
  } catch (error) { fail(error); }
});
$("web-clear").addEventListener("click",async() => {
  try {
    const account = owner();
    if (!window.confirm("删除本机保存的 @" + account + " 网页扫描快照？归档导入数据不会受影响。")) return;
    await removeWebSnapshot(account);
    if (snapshot?.owner === account) {
      snapshot = null; relationships = null; $("web-results").hidden = true;
    }
    feedback("已删除 @" + account + " 的本地网页扫描快照。");
  } catch (error) { fail(error); }
});
for (const button of document.querySelectorAll("[data-web-kind]")) {
  button.addEventListener("click",() => {
    if (!KINDS.includes(button.dataset.webKind)) return;
    selectedKind = button.dataset.webKind;
    currentPage = 0;
    for (const target of document.querySelectorAll("[data-web-kind]")) {
      target.setAttribute("aria-pressed",String(target === button));
    }
    renderList();
  });
}
$("web-filter").addEventListener("input",() => {currentPage=0;renderList();});
$("web-prev").addEventListener("click",() => {currentPage--;renderList();});
$("web-next").addEventListener("click",() => {currentPage++;renderList();});
$("web-export").addEventListener("click",() => {
  if (!snapshot || !relationships) return;
  const term = $("web-filter").value.trim().replace(/^@/,"").toLowerCase();
  const items = relationships[selectedKind].filter(x => x.includes(term));
  if (!items.length) return;
  const csv = "\uFEFFhandle,profile_url,category,source,coverage\r\n" +
    items.map(x => [x,"https://x.com/"+x,selectedKind,"dom_scan","unverified"].join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "xrh-web-" + snapshot.owner + "-" + selectedKind + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),3000);
});
window.addEventListener("beforeunload",() => {
  const job = running;
  if (!job) return;
  cancel();
  if (Number.isSafeInteger(job.tabId)) void chrome.tabs.remove(job.tabId).catch(()=>{});
});
