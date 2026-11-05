import { RUNTIME_CONFIG } from "../config/runtime.js";
import { mountPerformancePanel } from "./performance-panel.js";
import { AIProviderRouter } from "../services/ai-provider-router.js";
import { HistoryService } from "../services/history-service.js";
import { ReplyEngine } from "../services/reply-engine.js";
import { StorageService, PENDING_REQUEST_KEY, BEHAVIOR_PREFERENCES_KEY } from "../services/storage-service.js";
import { VoiceProfileService } from "../services/voice-profile-service.js";
import { UsageService } from "../services/usage-service.js";
import { HostedAIClient } from "../services/hosted-ai-client.js";
import { AccountClient } from "../services/account-client.js";

const storage = new StorageService();
const history = new HistoryService();
const profiles = new VoiceProfileService();
const usage = new UsageService();
const aiProvider = new AIProviderRouter();
const accountClient = new AccountClient();
const $ = (id) => document.getElementById(id);
const cards = $("reply-cards");
const styles = [["natural", "自然"], ["light_humor", "幽默"], ["thoughtful", "观点"]];
let currentRequest = null;
let currentResult = null;
let busy = false;
let queuedRequest = null;
const processed = new Set();
let accountPoll = null;

async function refreshDashboard() {
  const [account, summary, behavior, profile] = await Promise.all([
    chrome.runtime.sendMessage({ type: "REPLY_COPILOT_ACCOUNT_STATE" }).catch(() => null),
    usage.getSummary(), storage.getBehaviorPreferences(), profiles.get(),
  ]);
  $("stat-week").textContent = String(summary.last7DaysGenerations);
  $("stat-all").textContent = String(summary.totalGenerations);
  $("stat-copy").textContent = String(summary.copies);
  $("quick-style").value = behavior.defaultReplyMode;
  $("quick-auto").checked = behavior.autoGenerateOnReply;
  $("quick-language").value = profile.language;
  $("quick-length").value = profile.replyLength;
  $("quick-humor").value = profile.humorLevel;
  const status = account?.ok ? account.status : "auth_unavailable";
  $("quota-row").classList.toggle("hidden", !account?.quota || account.source !== "server");
  $("account-buttons").classList.toggle("hidden", !["guest", "auth_expired", "auth_unavailable"].includes(status) && !account?.pending);
  $("connect-register").classList.toggle("hidden", !["guest"].includes(status) || account?.pending);
  $("connect-login").classList.toggle("hidden", !["guest", "auth_expired"].includes(status) || account?.pending);
  $("check-binding").classList.toggle("hidden", !account?.pending && status !== "auth_unavailable");
  $("account-name").textContent = account?.pending ? "正在等待官网确认" : status === "guest" ? "尚未连接账户" : status === "auth_expired" ? "登录已过期" : status === "auth_unavailable" ? "暂时无法确认账户" : status === "frozen" ? "账户已冻结" : account?.user?.username || account?.user?.email || "已连接账户";
  $("account-summary").textContent = account?.pending ? "请在官网完成授权，返回后点击查看绑定状态。" : status === "guest" ? "注册并验证邮箱，免费领取 200 次。" : status === "auth_expired" ? "请重新连接官网账户。" : status === "auth_unavailable" ? "网络暂不可用，请重试；原账户凭据仍保留。" : status === "frozen" ? "AI 生成已停用。请到官网账户中心查看账户状态。" : status === "credits_exhausted" ? "生成次数已用完，支付暂未开放。" : "余额来自官网服务。";
  if (account?.quota && account.source === "server") { $("quota-total").textContent = String(account.quota.totalRemaining); $("quota-free").textContent = String(account.quota.freeRemaining); $("quota-paid").textContent = String(account.quota.paidRemaining); }
  if (account?.pending && !accountPoll) accountPoll = setInterval(() => void refreshDashboard(), 3500);
  if (!account?.pending && accountPoll) { clearInterval(accountPoll); accountPoll = null; }
}
async function claimPending() {
  const response = await chrome.runtime.sendMessage({ type: "REPLY_COPILOT_CLAIM_PENDING" }).catch(() => null);
  if (response?.ok && response.request) { if (busy) queuedRequest = response.request; else void generate(response.request); }
}
function showDashboard() { document.body.classList.add("dashboard-mode"); $("dashboard").classList.remove("hidden"); $("back-dashboard").classList.add("hidden"); $("status").classList.add("hidden"); $("result").classList.add("hidden"); $("regenerate").disabled = true; void refreshDashboard(); }

function formatReplyForClipboard(reply) {
  return reply
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function setBusy(value) {
  busy = value;
  $("regenerate").disabled = value || !currentRequest || Boolean(currentRequest.error);
  document.querySelectorAll(".copy-button").forEach((button) => { button.disabled = value; });
}
function showError(message, settings = false) {
  document.body.classList.remove("dashboard-mode");
  $("dashboard").classList.add("hidden"); $("back-dashboard").classList.remove("hidden");
  $("status").textContent = /[\u3400-\u9fff]/.test(message) ? message : /timed out|timeout|AbortError/i.test(message) ? "云端 AI 请求超时，请稍后重试。" : /Could not reach|network request failed|fetch/i.test(message) ? "无法连接云端服务，请检查网络后重试。" : /unauthorized/i.test(message) ? "账户授权已过期，请重新连接官网账户。" : /rate limit/i.test(message) ? "请求次数已达限制，请稍后重试。" : /invalid.*response|invalid JSON|structured response/i.test(message) ? "AI 返回内容无法识别，请重新生成。" : "回复生成失败，请重试。";
  $("status").className = "status error";
  $("status").classList.remove("hidden");
  $("result").classList.add("hidden");
  $("open-settings").classList.toggle("hidden", !settings);
  setBusy(false);
}
function showIdle() {
  $("status").textContent = "在 X 页面打开回复框，或选中文字后右键选择“生成回复”。";
  $("status").className = "status";
  $("status").classList.remove("hidden");
  $("result").classList.add("hidden");
  $("open-settings").classList.add("hidden");
  currentRequest = null; currentResult = null; setBusy(false);
  showDashboard();
}
function renderResult(result, preferredStyle = result.defaultStyle || result.default_style || "natural") {
  currentResult = result;
  $("source-text").textContent = currentRequest.sourceText;
  $("recommendation-badge").textContent = ({ reply: "建议回复", quote: "建议引用", skip: "建议跳过" })[result.recommendation] || result.recommendation;
  $("score").textContent = result.score == null ? "" : String(result.score);
  $("score").parentElement.classList.toggle("hidden", result.score == null);
  $("reason").textContent = result.reason;
  cards.replaceChildren();
  const orderedStyles = [...styles].sort(([left], [right]) => Number(right === preferredStyle) - Number(left === preferredStyle));
  for (const [style, label] of orderedStyles) {
    const article = document.createElement("article"); article.className = "card";
    const head = document.createElement("div"); head.className = "card-head";
    const title = document.createElement("h3"); title.textContent = label; head.append(title);
    if (preferredStyle === style) { const badge = document.createElement("span"); badge.className = "recommended"; badge.textContent = "默认"; head.append(badge); }
    const text = document.createElement("p"); text.className = "reply-text"; text.textContent = result.replies[style];
    const button = document.createElement("button"); button.className = "button copy-button"; button.textContent = "复制"; button.dataset.style = style;
    const feedback = document.createElement("div"); feedback.className = "card-feedback";
    const good = document.createElement("button"); good.className = "text-button"; good.textContent = "有帮助"; good.dataset.feedback = "good"; good.dataset.style = style;
    const bad = document.createElement("button"); bad.className = "text-button"; bad.textContent = "不太像我"; bad.dataset.feedback = "not_my_style"; bad.dataset.style = style;
    feedback.append(good, bad); article.append(head, text, button, feedback); cards.append(article);
  }
  $("quote-section").classList.toggle("hidden", result.recommendation !== "quote");
  $("quote-text").textContent = result.quote_candidate || "";
  $("status").classList.add("hidden"); $("open-settings").classList.add("hidden"); $("result").classList.remove("hidden"); setBusy(false);
  void refreshDashboard();
}
async function generate(request) {
  if (busy || processed.has(request.requestId)) return;
  processed.add(request.requestId);
  currentRequest = request; currentResult = null;
  document.body.classList.remove("dashboard-mode");
  $("dashboard").classList.add("hidden"); $("back-dashboard").classList.remove("hidden");
  if (request.error) { showError(request.error); return; }
  const requestId = request.requestId;
  for(const id of ["recover-generation","abandon-generation"])$(id).classList.add("hidden");
  $("status").textContent = "正在按你的风格生成回复…"; $("status").className = "status loading"; $("status").classList.remove("hidden"); $("result").classList.add("hidden"); $("open-settings").classList.add("hidden"); setBusy(true);
  try {
    if (currentRequest?.requestId !== requestId) return;
    const engine = new ReplyEngine({ aiClient: aiProvider, historyService: history });
    const preferences = await storage.getBehaviorPreferences();
    const result = await engine.generateReplies({ postContext: { text: request.sourceText, url: request.sourceUrl }, voiceProfile: await profiles.get(), requestId }, { replyStyle: await storage.getReplyStyle() });
    await Promise.allSettled([history.recordGeneration({ requestId, result }), usage.track("generated", { requestId })]);
    if (currentRequest?.requestId === requestId) renderResult(result, preferences.defaultReplyMode);
  } catch (error) {
    if (currentRequest?.requestId === requestId) { await usage.track("api_failure", { requestId }).catch(() => {}); showError(error.message || "Something went wrong. Try again.", error.needsSettings || error.message?.includes("API key is not configured"));
      const state=await new HostedAIClient({accountClient}).recoverGeneration().catch(()=>null);
      if(currentRequest?.requestId===requestId && (['running','ready','expired'].includes(state?.state)||['NETWORK_ERROR','GENERATION_IN_PROGRESS','DELIVERY_CONFIRMATION_PENDING'].includes(error.code)))for(const id of ['recover-generation','abandon-generation'])$(id).classList.remove('hidden'); }
  } finally {
    if (queuedRequest) { const next = queuedRequest; queuedRequest = null; void generate(next); }
  }
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (button.id === "back-dashboard") { showDashboard(); return; }
  if (button.id === "account-refresh" || button.id === "check-binding") { void refreshDashboard(); return; }
  if (button.id === "connect-register" || button.id === "connect-login") {
    button.disabled = true;
    const response = await chrome.runtime.sendMessage({ type: "REPLY_COPILOT_BEGIN_BINDING", mode: button.id === "connect-register" ? "register" : "login" }).catch(() => null);
    $("account-summary").textContent = response?.ok ? "已打开官网，请完成登录与授权。" : response?.error || "打开官网失败，请重试。";
    button.disabled = false; void refreshDashboard(); return;
  }
  const destinations = { "nav-website": "/", "nav-account": "/account", "nav-pricing": "/pricing", "nav-guide": "/guide" };
  if (destinations[button.id]) { try { await accountClient.openWebsite(destinations[button.id]); } catch { $("account-summary").textContent = "官网地址暂不可用。"; } return; }
  if (["settings", "footer-settings", "open-settings"].includes(button.id)) { chrome.runtime.openOptionsPage(); return; }
  if(['recover-generation','abandon-generation'].includes(button.id)&&currentRequest&&!busy){
    setBusy(true);button.disabled=true;
    try{
      const response=await chrome.runtime.sendMessage({type:'REPLY_COPILOT_RECOVER_GENERATION',abandon:button.id==='abandon-generation'});
      if(!response?.ok)throw Error(response?.error||'恢复未完成，请重试。');
      for(const id of ['recover-generation','abandon-generation'])$(id).classList.add('hidden');
      if(response.result){renderResult(response.result);if(response.requestId!==currentRequest.requestId)$('source-text').textContent='已恢复上一条回复；请核对原帖后再复制使用。';setBusy(false);}
      else{setBusy(false);aiProvider.accountStates.invalidate();processed.delete(currentRequest.requestId);void generate({...currentRequest,requestId:crypto.randomUUID()});}
    }catch(error){showError(error.message||'恢复失败，请重试。');}
    finally{button.disabled=false;}
    return;
  }
  if (button.id === "regenerate" && currentRequest && !busy) { generate({ ...currentRequest, requestId: crypto.randomUUID() }); return; }
  if (button.classList.contains("copy-button") && currentResult && currentRequest && !busy) {
    const style = button.dataset.style; const reply = formatReplyForClipboard(style === "quote" ? currentResult.quote_candidate : currentResult.replies[style]);
    try {
      await navigator.clipboard.writeText(reply);
    } catch { button.textContent = "复制失败"; setTimeout(() => { if (button.isConnected) button.textContent = style === "quote" ? "复制引用" : "复制"; }, 1400); return; }
    button.textContent = "已复制 ✓";
    try { await history.recordEvent(currentRequest.requestId, "copied", { reply, style }); await usage.track("copied", { requestId: currentRequest.requestId, style }); }
    catch { button.textContent = "已复制 · 历史未保存"; }
    setTimeout(() => { if (button.isConnected) button.textContent = style === "quote" ? "复制引用" : "复制"; }, 1300);
  }
  if (button.dataset.feedback && currentResult && currentRequest) {
    const action = button.dataset.feedback === "good" ? "feedback_good" : "feedback_bad";
    await usage.track(action, { requestId: currentRequest.requestId, style: button.dataset.style });
    button.textContent = "已记录 ✓";
    button.disabled = true;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes[PENDING_REQUEST_KEY]?.newValue) void claimPending();
  if (area === "local" && [BEHAVIOR_PREFERENCES_KEY, "voiceProfile", "replyCopilotAccountToken", "localUsageEvents"].some((key) => key in changes)) void refreshDashboard();
});
for (const id of ["quick-style", "quick-language", "quick-length", "quick-humor", "quick-auto"]) $(id).addEventListener("change", async () => {
  try {
    if (id === "quick-style") await storage.setBehaviorPreferences({ defaultReplyMode: $(id).value });
    else if (id === "quick-auto") await storage.setBehaviorPreferences({ autoGenerateOnReply: $(id).checked });
    else await profiles.save({ ...await profiles.get(), language: $("quick-language").value, replyLength: $("quick-length").value, humorLevel: $("quick-humor").value });
    $("quick-save-status").textContent = "已保存并同步到设置中心。";
  } catch { $("quick-save-status").textContent = "保存失败，请重试。"; }
});
showIdle(); void claimPending();

if(RUNTIME_CONFIG.channel === "staging")mountPerformancePanel(document,chrome.runtime);
