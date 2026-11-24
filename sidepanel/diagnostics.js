// On-demand local diagnosis only. Do not include arbitrary strings from tabs,
// account objects or exceptions in a shareable support report.
const ACCOUNT=new Set(["credits_available","credits_exhausted","frozen","guest","auth_expired","auth_unavailable","pending","unknown"]);
const STAGES=new Set(["capture","blocked","activated","waiting","bound","rebound","rejected","closed","window"]);
const REASONS=new Set(["reply_control_recognized","trusted_reply_click","activation_missing","activation_stale","competing_activation","recovery_required","no-post","post-context-incomplete","source_changed","untrusted_activation","source_unverified","preexisting_modal","clock_invalid","operation_expired","association_expired","route_changed","multiple_editors","awaiting_new_editor","awaiting_editor_remount","context_identity_conflict","stale_activation_ambiguous","awaiting_reply_context","reply_context_unconfirmed","editor_replaced_or_closed","awaiting_editor_focus","verified_editor_remount","preexisting_editor","not_reply_modal","existing_draft","new_focused_reply_editor","quiescent_recovery","reply_closed","cancelled_by_user","user_input_before_binding","editor_removed","mounted","mount_missing","disabled_by_setting","prepare_failed"]);
const WINDOWS=new Set(["absent","visible","not_visible"]);
const REASON_LABELS={reply_control_recognized:"已识别回复按钮",activation_missing:"缺少有效点击记录",activation_stale:"点击已超时",recovery_required:"请先关闭其他回复框", "no-post":"未识别帖子容器","post-context-incomplete":"原帖信息不完整",source_changed:"原帖发生变化",preexisting_modal:"已有回复弹窗",multiple_editors:"检测到多个编辑器",association_expired:"等待回复框超时",awaiting_new_editor:"等待新回复框",awaiting_editor_focus:"等待编辑器焦点",awaiting_reply_context:"等待原帖上下文",reply_context_unconfirmed:"无法确认回复对应原帖",context_identity_conflict:"回复目标与原帖不一致",existing_draft:"检测到已有草稿",preexisting_editor:"回复框在点击前已存在",not_reply_modal:"非弹窗回复框",mounted:"悬浮窗已挂载",mount_missing:"悬浮窗挂载失败",disabled_by_setting:"悬浮窗设置已关闭",prepare_failed:"读取设置或准备失败",new_focused_reply_editor:"已绑定回复框",reply_closed:"回复框已关闭",operation_expired:"回复操作已过期",user_input_before_binding:"用户已开始输入"};
const flag=v=>typeof v==="boolean"?v:null;
const count=v=>Number.isInteger(v)&&v>=0&&v<=100?v:null;
const enumValue=(set,v)=>set.has(v)?v:"unknown";
const version=v=>typeof v==="string"&&/^\d+(?:\.\d+){0,3}$/.test(v)?v:"unknown";
export function sanitizeProbe(probe){
  if(probe?.ok!==true||probe.schema!==1)return null;
  return {replyControlPresent:flag(probe.replyControlPresent),visibleEditors:count(probe.visibleEditors),
    replyDialogs:count(probe.replyDialogs),windowState:enumValue(WINDOWS,probe.windowState),
    events:Array.isArray(probe.events)?probe.events.slice(-12).map(e=>({stage:enumValue(STAGES,e?.stage),reason:enumValue(REASONS,e?.reason)})):[]};
}
function classifyPage(tab){
  if(!tab)return "no_tab";
  if(typeof tab.url!=="string"||!tab.url)return "unknown";
  try{const u=new URL(tab.url);return u.protocol==="https:"&&["x.com","twitter.com","www.x.com","www.twitter.com"].includes(u.hostname)?"x":"other";}
  catch{return "unknown";}
}
async function boundedProbe(chromeApi,id){
  let timer;
  try{
    return await Promise.race([chromeApi.tabs.sendMessage(id,{type:"REPLY_COPILOT_LOCAL_DIAGNOSTICS"},{frameId:0}),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),2000);})]);
  }catch{return null;}finally{clearTimeout(timer);}
}
export async function collectDiagnostics({chromeApi=globalThis.chrome,userAgent="",preferences={},accountStatus="unknown"}={}){
  const report={schema:1,extensionVersion:version(chromeApi.runtime.getManifest().version),
    browserVersion:version(/(?:Chrome|Chromium)\/(\d+(?:\.\d+){0,3})/.exec(userAgent)?.[1]),
    accountStatus:enumValue(ACCOUNT,accountStatus),floatingEnabled:flag(preferences.showFloatingWindow),
    autoGenerate:flag(preferences.autoGenerateOnReply),page:"unknown",siteAccess:"unknown",contentScript:"unknown",probe:null};
  try{
    const [tab]=await chromeApi.tabs.query({active:true,currentWindow:true});
    report.page=classifyPage(tab);
    if(!Number.isInteger(tab?.id)||report.page==="other")return report;
    // Host access can be withheld. Unknown tab URL is NOT proof of denial.
    const origins=report.page==="x"&&tab.url?["https://"+new URL(tab.url).hostname+"/*"]:["https://x.com/*"];
    try{if(await chromeApi.permissions.contains({origins}))report.siteAccess="granted";}catch{}
    const response=await boundedProbe(chromeApi,tab.id);
    report.probe=sanitizeProbe(response);
    if(report.probe){report.page="x";report.siteAccess="reachable";report.contentScript="running";}
    else report.contentScript=response?.schema===1?"probe_failed":"no_response";
  }catch{}
  return report;
}
export function diagnosticRows(r){
  const p=r.probe;
  const account={credits_available:"已连接",credits_exhausted:"已连接，额度用完",frozen:"已连接，账户冻结",guest:"未连接",auth_expired:"授权过期",auth_unavailable:"暂不可用",pending:"绑定中",unknown:"尚未确认"};
  return [
    ["账户连接",account[r.accountStatus]||"尚未确认"],
    ["当前页面",({x:"X 页面",other:"非 X 页面",no_tab:"未找到标签页",unknown:"无法确认，请在 X 页面检查"})[r.page]],
    ["网站访问",({granted:"浏览器报告已授权",reachable:"已可访问当前页",unknown:"未确认，请检查网站访问权限"})[r.siteAccess]],
    ["内容脚本",({running:"正常响应",no_response:"无响应，请刷新 X",probe_failed:"响应异常",unknown:"未检查"})[r.contentScript]],
    ["悬浮窗设置",r.floatingEnabled===true?"已开启":r.floatingEnabled===false?"已关闭":"未知"],
    ["标准回复按钮",p?.replyControlPresent===true?"已找到":p?.replyControlPresent===false?"未找到标准按钮（可能为不同布局）":"未检查"],
    ["可见编辑框 / 回复弹窗",p?String(p.visibleEditors??"未知")+" / "+String(p.replyDialogs??"未知"):"未检查"],
    ["悬浮窗当前状态",p?({visible:"已显示",not_visible:"已挂载但不可见",absent:"未显示",unknown:"未知"})[p.windowState]:"未检查"],
    ["最近一次事件",p?.events.length?(REASON_LABELS[p.events.at(-1).reason]||p.events.at(-1).reason):"暂无（请在 X 点击回复后重新检查）"]
  ];
}

export function diagnosticAdvice(r){
 if(r.page==="other"||r.page==="no_tab")return "请切换到 X 标签页，再打开侧栏检查。";
 if(r.floatingEnabled===false)return "请在设置 → 插件行为开启「显示回复悬浮框」，保存后刷新 X。";
 if(r.contentScript!=="running")return "请检查扩展的网站访问权限，刷新 X 后再点击普通文字帖的回复按钮。无响应不代表权限一定被拒绝。";
 const p=r.probe;
 if(p?.windowState==="visible")return "悬浮窗已挂载且位于可视区域。如果实际看不到，请复制报告反馈。";
 if(p?.windowState==="not_visible")return "悬浮窗已挂载但不在可视区域；请在设置中重置悬浮框位置，关闭当前回复框后重试。";
 const reason=p?.events.at(-1)?.reason;
 if(["existing_draft","preexisting_editor","preexisting_modal","multiple_editors","competing_activation","recovery_required","user_input_before_binding"].includes(reason))
  return "请先保存已有草稿，关闭其他回复框，然后在一条普通文字帖下重新点击回复。";
 if(["post-context-incomplete","no-post","reply_context_unconfirmed","context_identity_conflict","not_reply_modal","source_changed","association_expired"].includes(reason))
  return "可能是当前 X 页面布局未适配。请尝试普通文字帖，若仍不出现，请复制报告给客服。";
 if(reason==="awaiting_editor_focus")return "请点击回复编辑框使其获得焦点，再重新检查。";
 if(reason==="prepare_failed")return "插件准备失败，请刷新 X 后重试，并复制报告给客服。";
 return "请先点击普通文字帖的回复按钮，再次检查；若仍不出现，请复制报告给客服。";
}
