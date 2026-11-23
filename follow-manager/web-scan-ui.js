import {normalizeHandle, classifyRelationships} from "./archive.js";
import {saveWebSnapshot, readWebSnapshot, removeWebSnapshot} from "./web-scan-store.js";

const $ = id => document.getElementById(id);
const KINDS = ["mutual","notFollowingBack","iHaveNotFollowedBack"];
const STAGES = ["following","followers"];
const PAGE_SIZE = 50;
const MAX_HANDLES = 3000;
const REASON = {
  bottom_observed:"已观察到列表底部（完整性未验证）",
  limit:"达到人数或循环上限，结果不完整",
  timeout:"扫描超时，结果不完整",
  page_changed:"页面已跳转，扫描中断",
  page_unavailable:"网页关注列表无法加载",
  page_error:"网页扫描出错",
  cancelled:"用户已停止",
  empty:"未读取到用户卡片，请检查登录和页面",
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
  feedback(error instanceof Error ? error.message : "扫描失败，请检查 X 页面并重试。",true);
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
    setStatus(job.kind,message.count,"正在从 X 网页收集可见账号…");
    feedback("正在扫描「" + stageName(job.kind) + "」，已发现 " + message.count + " 个账号。请保持 X 标签页在前台。");
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
  throw new Error("无法在 X 页面连接扫描器。请确认已登录 X 并刷新页面后重试。");
}
async function stage(job,kind,first) {
  job.kind = kind;
  job.scanId = crypto.randomUUID();
  job.pending = null;
  setStatus(kind,null,"正在打开 X 关注列表…");
  feedback("正在打开「" + stageName(kind) + "」页面，请保持 X 标签页在前台。");
  if (!first) {
    await chrome.tabs.update(job.tabId,{
      url:"https://x.com/" + job.owner + "/" + kind,
      active:true,
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
    (search ? "（已筛选）" : "（不保证名单完整）");
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
  $("web-result-badge").textContent = ended ? "观察到页底 · 未验证完整" : "部分结果 · 未保存";
  $("web-snapshot-meta").textContent = "@" + data.owner + " · " + time +
    " · 扫描关注 " + data.following.length + " 人 · 扫描粉丝 " + data.followers.length +
    " 人 · " + (localSaved ? "本机保存快照" : "本次观察结果") +
    " · 关注页：" + (REASON[data.reasons.following] || "未知") +
    "；粉丝页：" + (REASON[data.reasons.followers] || "未知");
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
  if (!$("web-consent").checked) {
    feedback("请先确认扫描的是自己的 X 账号，并阅读网页扫描风险说明。",true);
    return;
  }
  const job = {owner:account,tabId:null,cancelled:false,kind:null,scanId:null,pending:null};
  running = job;
  setBusy(true);
  setStatus("following",null,"等待开始");
  setStatus("followers",null,"等待开始");
  $("web-results").hidden = true;
  snapshot = null;
  relationships = null;
  try {
    const tab = await chrome.tabs.create({url:"https://x.com/"+account+"/following",active:true});
    if (!Number.isSafeInteger(tab?.id)) throw new Error("浏览器未能创建 X 扫描标签页。");
    job.tabId = tab.id;
    const following = await stage(job,"following",true);
    if (job.cancelled || following.reason === "cancelled") throw new Error("已停止网页扫描。");
    setStatus("following",following.handles.length,REASON[following.reason]);
    if (["empty","page_changed","page_unavailable","page_error"].includes(following.reason)) {
      throw new Error("关注页未能完成扫描：" + REASON[following.reason] + "。已停止，没有保存快照。");
    }
    const followers = await stage(job,"followers",false);
    if (job.cancelled || followers.reason === "cancelled") throw new Error("已停止网页扫描。");
    setStatus("followers",followers.handles.length,REASON[followers.reason]);
    if (["empty","page_changed","page_unavailable","page_error"].includes(followers.reason)) {
      throw new Error("粉丝页未能完成扫描：" + REASON[followers.reason] + "。已停止，没有保存快照。");
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
      "两轮扫描都观察到页面底部，已保存本地观察快照。请注意：仍不能证明扫描了全部账号。" :
      "至少一轮扫描达到时间/数量上限。本次仅显示可能不完整的结果，没有覆盖已保存的快照。",
      !observedEnds);
  } catch (error) { fail(error); }
  finally {
    if (running === job) running = null;
    setBusy(false);
  }
}
function cancel() {
  if (!running) return;
  const job = running;
  job.cancelled = true;
  feedback("正在停止扫描…");
  if (job.tabId && job.scanId) {
    void chrome.tabs.sendMessage(job.tabId,{type:"XRH_FOLLOW_WEB_CANCEL",scanId:job.scanId}).catch(()=>{});
  }
  job.pending?.reject(new Error("已停止网页扫描，未保存此次扫描结果。"));
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
    feedback("已读取 @" + account + " 的本地网页观察快照（非实时、完整性未验证）。");
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
window.addEventListener("beforeunload",cancel);
