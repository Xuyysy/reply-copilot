import {normalizeHandle, classifyRelationships} from "./archive.js";
import {saveInternalSnapshot, readInternalSnapshot, removeInternalSnapshot,
  saveInternalCheckpoint,readInternalCheckpoint,clearInternalCheckpoint}
  from "./internal-sync-store.js";
import {verificationFor,validVerification,validIds,selectAccounts,compareSnapshots,snapshotIsCurrent}
  from "./results-utils.js";
import {MAX_INTERNAL_HANDLES,validStage,readCheckpoint,withStage,resumable}
  from "./internal-sync-state.js";

const $ = id => document.getElementById(id);
const KINDS = ["mutual","notFollowingBack","iHaveNotFollowedBack"];
// Following and followers are read sequentially from a temporary inactive X tab.
const PAGE_SIZE = 50;
const MAX_HANDLES = MAX_INTERNAL_HANDLES;
const LAST_OWNER_KEY = "xrh-follow-internal-last-owner";
// Each explicit batch can stop and be continued from a locally stored cursor.
const REASON = {
  complete:"已同步完成",
  paused:"已保存当前批次，点击「继续同步」获取下一批",
  limit:"达到本地最大保存数量 30,000 人；结果仍可能不完整",
  timeout:"同步超时，当前进度已保存",
  cursor_loop:"X 返回了重复的分页位置，本次停止",
  rate_limited:"X 暂时限制了请求，请稍后再试",
  login_required:"X 登录状态已失效，请重新登录",
  account_mismatch:"当前登录的 X 账号不匹配",
  page_changed:"X 页面已离开当前账号列表",
  schema:"X 返回了无法识别的数据格式",
  schema_timeline:"X 返回的名单结构不完整，本次未判定同步结束",
  query_not_found:"X 当前查询地址不可用（HTTP 404），可能是接口版本变更",
  invalid_request:"X 不接受当前查询参数（HTTP 400/422），可能是接口版本变更",
  invalid_json:"X 返回了非 JSON 内容",
  graphql_error:"X 返回了 GraphQL 查询错误，可能是接口或权限发生变化",
  http_error:"X 服务暂时返回错误，请稍后再试",
  network:"无法连接 X，请检查网络",
  stalled:"分页没有新增数据，已保留当前进度",
  cancelled:"已停止",
  empty:"没有读到账号，无法判断列表是否完整",
};
let running = null;
let snapshot = null;
let relationships = null;
let selectedKind = "mutual";
let currentPage = 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function feedback(text, error=false) {
  $("internal-status").textContent = text;
  $("internal-status").classList.toggle("error",error);
}
function fail(error) {
  feedback(error instanceof Error ? error.message : "分析未能完成，请检查 X 是否已登录后重试。",true);
}
function elapsedLabel(ms) {
  const total = Math.max(0,Math.floor(ms / 1000));
  return "已用时间 " + String(Math.floor(total / 60)).padStart(2,"0") + ":" + String(total % 60).padStart(2,"0");
}
function updateElapsed(job) {
  $("internal-elapsed").textContent = elapsedLabel(Date.now() - job.startedAt);
}
async function closeTemporaryTab(job) {
  if (!Number.isSafeInteger(job.tabId)) return;
  const tabId = job.tabId;
  job.tabId = null;
  try { await chrome.tabs.remove(tabId); } catch {}
}
function owner() {
  const value = normalizeHandle($("internal-owner").value);
  if (["home","explore","search","settings","messages","notifications"].includes(value)) {
    throw new Error("请输入自己的 X 用户名，而不是 X 页面路径。");
  }
  return value;
}
function stageName(kind) { return kind === "following" ? "正在关注" : "粉丝"; }
function setStatus(kind,count,label) {
  $(kind === "following" ? "internal-following-count" : "internal-followers-count").textContent =
    Number.isSafeInteger(count) ? count.toLocaleString("zh-CN") : "—";
  $(kind === "following" ? "internal-following-state" : "internal-followers-state").textContent = label;
}
function setBusy(busy) {
  $("internal-start").disabled = busy;
  $("internal-cancel").disabled = !busy;
  $("internal-load").disabled = busy;
  $("internal-clear").disabled = busy;
  $("internal-reset").disabled = busy;
  $("internal-owner").disabled = busy;
  $("internal-loading").hidden = !busy;
  if (busy) $("internal-loading-title").textContent = "正在整理关注关系…";
}
function validHandles(handles) {
  return Array.isArray(handles) && handles.length <= MAX_HANDLES &&
    handles.every(x => typeof x === "string" && /^[a-z0-9_]{1,15}$/.test(x));
}
function validateSnapshot(value) {
  return value && typeof value === "object" &&
    typeof value.owner === "string" && /^[a-z0-9_]{1,15}$/.test(value.owner) &&
    validHandles(value.followers) && validHandles(value.following) &&
    validVerification(value.verification) && validIds(value.ids) &&
    value.reasons && typeof value.reasons.following === "string" &&
    typeof value.reasons.followers === "string";
}

function queueCheckpoint(job,kind,stage) {
  if(!validStage(stage) || job.owner!==job.checkpoint?.owner) return;
  job.checkpoint=withStage(job.checkpoint,job.owner,kind,stage);
  // Order writes; a late progress event must not resurrect an old checkpoint
  // after a successful full snapshot transaction removes it.
  const copy=job.checkpoint;
  job.writes=job.writes.then(()=>saveInternalCheckpoint(copy))
    .catch(error=>{job.writeError=error || new Error("保存进度失败。");});
}
chrome.runtime.onMessage.addListener((message,sender) => {
  const job=running;
  if(!job || !job.pending || sender.id!==chrome.runtime.id ||
      sender.tab?.id!==job.tabId || message?.scanId!==job.scanId ||
      message?.kind!==job.kind) return;
  if(message.type==="XRH_INTERNAL_PROGRESS") {
    if(!Number.isSafeInteger(message.count) || message.count<0 ||
       message.count>MAX_HANDLES) return;
    setStatus(job.kind,message.count,"已读取第 "+(message.pages||"?")+" 页…");
    $("internal-loading-title").textContent="正在整理「"+stageName(job.kind)+"」";
    feedback("「"+stageName(job.kind)+"」已读取 "+message.count+" 人，保存进度后可继续。");
    if(message.checkpoint && validStage(message.checkpoint)) {
      queueCheckpoint(job,job.kind,message.checkpoint);
    }
  } else if(message.type==="XRH_INTERNAL_DONE") {
    if(!validStage(message) || !Object.hasOwn(REASON,message.reason)) {
      job.pending.reject(new Error("X 返回了无效的账号数据，本次未写入完整快照。"));
      return;
    }
    job.pending.resolve({
      handles:message.handles,reason:message.reason,cursor:message.cursor,
      verification:message.verification||{},ids:message.ids||{},
      pages:message.pages||0,userId:message.userId
    });
  }
});

async function waitReady(job) {
  const start = Date.now();
  while (Date.now() - start < 45_000) {
    if (job.cancelled) throw new Error("已停止分析。");
    try {
      const check = await chrome.tabs.sendMessage(job.tabId,{type:"XRH_INTERNAL_PING"});
      if (check?.loggedIn && check.loggedIn !== job.owner) {
        throw Object.assign(new Error("当前登录 X 的用户名不匹配。"),{fatal:true});
      }
      if (check?.ok && check.route?.owner === job.owner &&
          check.route.kind === job.kind && check.loggedIn === job.owner) return;
    } catch(error) {
      if (error?.fatal) throw error;
      // X may still be loading the extension's content scripts.
    }
    await sleep(950);
  }
  throw new Error("无法连接 X 的快速同步功能，请确认 X 已登录后重试。");
}
async function stage(job,kind,first,resume=null) {
  job.kind = kind;
  job.scanId = crypto.randomUUID();
  job.pending = null;
  setStatus(kind,null,"正在准备…");
  $("internal-loading-title").textContent = "正在整理「" + stageName(kind) + "」";
  feedback("正在后台读取「" + stageName(kind) + "」的数据…");
  if (!first) {
    await chrome.tabs.update(job.tabId,{
      url:"https://x.com/" + job.owner + "/" + kind,
    });
  }
  await waitReady(job);
  if (job.cancelled) throw new Error("已停止分析。");
  setStatus(kind,resume?.handles?.length ?? null,resume ? "从上次分页位置继续…" : "正在读取数据…");
  const scanId = job.scanId;
  return new Promise((resolve,reject) => {
    let settled = false;
    const timeout = setTimeout(() => finish(new Error("处理时间较长，已停止本次分析。")),
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
      type:"XRH_INTERNAL_START", scanId, owner:job.owner, kind,
      ...(resume ? {resume} : {}),
    }).then(response => {
      if (!response?.ok) finish(new Error(response?.error || "无法开始同步 X 页面。"));
    }).catch(error => finish(new Error("暂时无法连接 X 数据页面：" + (error?.message || "未知错误"))));
  });
}
function renderList() {
  if (!relationships) return;
  const search = $("internal-filter").value.trim().replace(/^@/,"").toLowerCase();
  const items = selectAccounts(relationships[selectedKind],search,
    $("internal-verified").value,snapshot);
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
    if (verificationFor(snapshot,handle) === true) {
      const badge=document.createElement("span");
      badge.className="blue-v-chip";
      badge.textContent="✓ 蓝 V";
      badge.title="X 同步时确认的蓝色认证标识";
      label.append(badge);
    }
    row.append(label,link);
    fragment.append(row);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配的本次同步记录。";
    fragment.append(empty);
  }
  $("internal-result-list").replaceChildren(fragment);
  $("internal-result-count").textContent = "当前分类共 " + items.length + " 条获取记录" +
    (search ? "（已筛选）" : "（结果可能不完整）");
  $("internal-page-info").textContent = (currentPage+1) + " / " + pageCount;
  $("internal-prev").disabled = currentPage === 0;
  $("internal-next").disabled = currentPage === pageCount - 1;
  $("internal-export").disabled = items.length === 0;
}
function renderSnapshot(data,localSaved=false) {
  if (!validateSnapshot(data)) throw new Error("本地数据格式不正确。");
  snapshot = data;
  relationships = classifyRelationships(data.followers,data.following);
  const change=compareSnapshots(data,data.history?.[0]);
  const changes=$("internal-changes");
  if (change) {
    changes.hidden=false;
    changes.textContent="与上次完整记录相比：新增粉丝 " + change.newFollowers +
      " 人、减少 " + change.missingFollowers + " 人。"+
      (change.byStableId ? "按账号 ID 比较。" : "按用户名估算，改名或漏加载也可能产生差异。");
  } else {
    changes.hidden=true;
    changes.textContent="";
  }
  $("internal-results").hidden = false;
  $("internal-mutual").textContent = relationships.mutual.length.toLocaleString("zh-CN");
  $("internal-not-following-back").textContent = relationships.notFollowingBack.length.toLocaleString("zh-CN");
  $("internal-i-not-followed-back").textContent = relationships.iHaveNotFollowedBack.length.toLocaleString("zh-CN");
  const imported = new Date(data.importedAt);
  const time = Number.isFinite(imported.getTime()) ? imported.toLocaleString("zh-CN") : "时间未知";
  const ended = data.reasons.following === "complete" && data.reasons.followers === "complete";
  $("internal-result-badge").textContent = ended ? "本次分析完成" : "部分结果";
  $("internal-snapshot-meta").textContent = "@" + data.owner + " · " + time +
    " · 我关注 " + data.following.length + " 人 · 关注我的人 " + data.followers.length +
    " 人 · " + (localSaved ? "已保存到本机" : "本次结果") +
    (ended ? "" : " · 本次数据可能不完整") +
    (localSaved && !snapshotIsCurrent(data) ? " · 超过 24 小时，建议按需刷新" : "");
  selectedKind = "mutual";
  currentPage = 0;
  $("internal-filter").value = "";
  $("internal-verified").value="all";
  $("internal-start").textContent="更新关注关系";
  for (const button of document.querySelectorAll("[data-internal-kind]")) {
    button.setAttribute("aria-pressed",String(button.dataset.internalKind === selectedKind));
  }
  renderList();
}
async function start() {
  if(running) return;
  let account;
  try {account=owner();} catch(error){fail(error);return;}
  if(!$("internal-consent").checked) {
    feedback("请先确认同步的是自己的 X 账号。",true);
    return;
  }
  try {localStorage.setItem(LAST_OWNER_KEY,account);} catch{}
  const job={owner:account,tabId:null,cancelled:false,kind:null,scanId:null,
    pending:null,startedAt:Date.now(),timer:null,writes:Promise.resolve(),
    writeError:null,checkpoint:null};
  running=job;
  setBusy(true);
  updateElapsed(job);
  job.timer=setInterval(()=>{if(running===job)updateElapsed(job);},1000);
  // Do not clear the last complete snapshot while updating.
  if(!snapshot || snapshot.owner!==account) {
    $("internal-results").hidden=true;
    snapshot=null;relationships=null;
  }
  try {
    const cached=readCheckpoint(await readInternalCheckpoint(account),account);
    job.checkpoint=cached||{owner:account,stages:{},savedAt:new Date().toISOString()};
    let following=job.checkpoint.stages.following;
    let followers=job.checkpoint.stages.followers;
    const needFollowing=following?.reason!=="complete";
    if(!needFollowing && validStage(following)) {
      setStatus("following",following.handles.length,"上次已完成，无需重复同步");
    } else {
      // New refreshes must not accidentally mix in an incompatible old stage.
      if(following && !resumable(following)) {
        job.checkpoint={owner:account,stages:{},savedAt:new Date().toISOString()};
        following=null;followers=null;
      }
    }
    const firstKind=needFollowing ? "following" : "followers";
    const tab=await chrome.tabs.create({url:"https://x.com/"+account+"/"+firstKind,active:false});
    if(!Number.isSafeInteger(tab?.id))throw new Error("Chrome 无法打开临时 X 数据标签。");
    job.tabId=tab.id;
    if(needFollowing) {
      following=await stage(job,"following",true,resumable(following)?following:null);
      await job.writes;
      queueCheckpoint(job,"following",following);
      await job.writes;
      if(job.writeError)throw job.writeError;
      setStatus("following",following.handles.length || null,REASON[following.reason]);
      if(following.reason!=="complete") {
        $("internal-start").textContent="继续同步";
        feedback("我关注的人： "+(REASON[following.reason]||"本次未完成")+
          "，已保存 "+following.handles.length+" 人。下次可继续；旧结果未覆盖。",true);
        return;
      }
      // Never carry a stale followers stage into a fresh following stage.
      if(!cached?.stages?.following || cached.stages.following.reason!=="complete")
        followers=null;
    }
    if(job.cancelled) {feedback("已停止，已保留本次进度。");return;}
    if(followers?.reason!=="complete") {
      followers=await stage(job,"followers",!needFollowing,resumable(followers)?followers:null);
      await job.writes;
      queueCheckpoint(job,"followers",followers);
      await job.writes;
      if(job.writeError)throw job.writeError;
      setStatus("followers",followers.handles.length || null,REASON[followers.reason]);
      if(followers.reason!=="complete") {
        $("internal-start").textContent="继续同步";
        feedback("关注我的人： "+(REASON[followers.reason]||"本次未完成")+
          "，已保存 "+followers.handles.length+" 人。点击继续从当前分页位置读取，不重复第一轮。",true);
        return;
      }
    } else {
      setStatus("followers",followers.handles.length,"之前已完成");
    }
    if(!following || following.reason!=="complete" || !followers || followers.reason!=="complete")
      throw new Error("两组名单尚未完整，未生成互关结果。");
    const data={
      owner:account,source:"internal_sync",importedAt:new Date().toISOString(),
      following:following.handles,followers:followers.handles,
      verification:{...following.verification,...followers.verification},
      ids:{...following.ids,...followers.ids},
      reasons:{following:"complete",followers:"complete"}
    };
    await job.writes;
    if(job.writeError)throw job.writeError;
    const completeRecord=await saveInternalSnapshot(data);
    job.checkpoint=null;
    renderSnapshot(completeRecord,true);
    $("internal-start").textContent="更新关注关系";
    feedback("两组名单均已同步完成，本地完整记录已更新。");
  } catch(error) {fail(error);}
  finally {
    clearInterval(job.timer);
    updateElapsed(job);
    await closeTemporaryTab(job);
    if(running===job)running=null;
    setBusy(false);
  }
}

function cancel() {
  if (!running) return;
  const job = running;
  job.cancelled = true;
  feedback("正在停止分析…");
  if (job.tabId && job.scanId) {
    void chrome.tabs.sendMessage(job.tabId,{type:"XRH_INTERNAL_CANCEL",scanId:job.scanId}).catch(()=>{});
  }
  // Give the page a chance to report its last valid cursor and persist it.
  // Fall back if X already navigated away.
  if(job.pending) {
    const pending=job.pending;
    setTimeout(()=>{
      if(job.pending===pending) pending.reject(new Error("已停止，已保存此前的同步进度。"));
    },3500);
  }
}
$("internal-start").addEventListener("click",() => { void start(); });
$("internal-cancel").addEventListener("click",cancel);
$("internal-load").addEventListener("click",async() => {
  try {
    const account = owner();
    const data = await readInternalSnapshot(account);
    if (!data) {feedback("本机没有 @" + account + " 的历史结果。");return;}
    if (data.owner !== account) throw new Error("本地记录账号不匹配。");
    renderSnapshot(data,true);
    localStorage.setItem(LAST_OWNER_KEY,account);
    feedback("已读取 @" + account + " 上次保存在本机的结果。");
  } catch (error) { fail(error); }
});
$("internal-reset").addEventListener("click",async() => {
  if(running) return;
  try {
    const account=owner();
    if(!window.confirm("清除 @" + account + " 的未完成同步进度并重新开始？已保存的完整名单不会删除。")) return;
    await clearInternalCheckpoint(account);
    $("internal-start").textContent="重新同步";
    setStatus("following",null,"进度已重置");
    setStatus("followers",null,"进度已重置");
    feedback("已清除未完成的同步进度，历史完整结果仍在。");
  } catch(error) {fail(error);}
});
$("internal-clear").addEventListener("click",async() => {
  try {
    const account = owner();
    if (!window.confirm("删除本机保存的 @" + account + " 互关记录？其他导入数据不受影响。")) return;
    await removeInternalSnapshot(account);
    if (localStorage.getItem(LAST_OWNER_KEY) === account) localStorage.removeItem(LAST_OWNER_KEY);
    if (snapshot?.owner === account) {
      snapshot = null; relationships = null; $("internal-results").hidden = true;
    }
    feedback("已删除 @" + account + " 的本地互关记录。");
  } catch (error) { fail(error); }
});
for (const button of document.querySelectorAll("[data-internal-kind]")) {
  button.addEventListener("click",() => {
    if (!KINDS.includes(button.dataset.internalKind)) return;
    selectedKind = button.dataset.internalKind;
    currentPage = 0;
    for (const target of document.querySelectorAll("[data-internal-kind]")) {
      target.setAttribute("aria-pressed",String(target === button));
    }
    renderList();
  });
}
$("internal-verified").addEventListener("change",()=>{currentPage=0;renderList();});
$("internal-filter").addEventListener("input",() => {currentPage=0;renderList();});
$("internal-prev").addEventListener("click",() => {currentPage--;renderList();});
$("internal-next").addEventListener("click",() => {currentPage++;renderList();});
$("internal-export").addEventListener("click",() => {
  if (!snapshot || !relationships) return;
  const term = $("internal-filter").value.trim().replace(/^@/,"").toLowerCase();
  const items = selectAccounts(relationships[selectedKind],term,
    $("internal-verified").value,snapshot);
  if (!items.length) return;
  const csv = "\uFEFFhandle,profile_url,category,source,coverage,blue_verified\r\n" +
    items.map(x => [x,"https://x.com/"+x,selectedKind,"internal_sync","unverified",
      verificationFor(snapshot,x) === null ? "unknown" : String(verificationFor(snapshot,x))].join(","))
      .join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
  const link = document.createElement("a");
  link.href = url;
  link.download = "xrh-internal-" + snapshot.owner + "-" + selectedKind + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),3000);
});
async function restoreLastResult(account) {
  try {
    const existing=await readInternalSnapshot(account);
    const pending=readCheckpoint(await readInternalCheckpoint(account),account);
    if(running || $("internal-owner").value.trim().replace(/^@/,"").toLowerCase()!==account) return;
    if(existing) {
      renderSnapshot(existing,true);
      setStatus("following",existing.following.length,"上次完整记录");
      setStatus("followers",existing.followers.length,"上次完整记录");
    }
    if(pending?.stages) {
      const a=pending.stages.following;
      const b=pending.stages.followers;
      const stageToContinue=a?.reason!=="complete" ? a : b;
      if(a) setStatus("following",a.handles.length,a.reason==="complete"?"本轮已完成":"已保存进度");
      if(b) setStatus("followers",b.handles.length,b.reason==="complete"?"本轮已完成":"已保存进度");
      $("internal-start").textContent="继续同步";
      feedback("上次同步进度已恢复：关注 "+(a?.handles?.length||0)+" 人、粉丝 "+
        (b?.handles?.length||0)+" 人。点击继续后从已保存的分页位置读取。");
    } else {
      $("internal-start").textContent=existing?"更新关注关系":"开始快速同步";
      feedback(existing ? "已显示 @" + account + " 上次完整结果；需要最新数据再点击更新。" :
        "暂无本地记录，可以开始同步。");
    }
  } catch(error) {fail(error);}
}

$("internal-owner").addEventListener("change",()=>{
  if (running) return;
  try {
    const account=owner();
    $("internal-results").hidden=true;
    snapshot=null;relationships=null;
    if (account) void restoreLastResult(account);
  } catch(error) {fail(error);}
});
try {
  const last=localStorage.getItem(LAST_OWNER_KEY);
  if (last && /^[a-z0-9_]{1,15}$/.test(last)) {
    $("internal-owner").value="@"+last;
    void restoreLastResult(last);
  }
} catch {}
window.addEventListener("beforeunload",() => {
  const job = running;
  if (!job) return;
  cancel();
  if (Number.isSafeInteger(job.tabId)) void chrome.tabs.remove(job.tabId).catch(()=>{});
});
