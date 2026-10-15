import { StorageService } from "../services/storage-service.js";
import { testDeepSeekConnection } from "../services/deepseek-client.js";
import { DEFAULT_MODEL } from "../services/deepseek-client.js";
import { VoiceProfileService } from "../services/voice-profile-service.js";
import { createZaneVoiceProfile } from "../domain/voice-profile.js";
import { UsageService } from "../services/usage-service.js";
import { HistoryService } from "../services/history-service.js";
import { AccountClient } from "../services/account-client.js";
import { AccountStateService } from "../services/account-state-service.js";
import { accountStatusLabel } from "../domain/account-state.js";
import { RUNTIME_CONFIG } from "../config/runtime.js";
import { writeDevMock } from "../config/dev-state.js";

const storage = new StorageService(), profiles = new VoiceProfileService(), usage = new UsageService(), history = new HistoryService();
const accountClient = new AccountClient(), accountStates = new AccountStateService({ client: accountClient });
const $ = (id) => document.getElementById(id);
const input = $("api-key"), state = $("key-state"), message = $("message"), hostAccess = $("host-access"), testButton = $("test");
let configuredKey = "", profile = null;
const DEEPSEEK_ORIGIN = "https://api.deepseek.com/*";
const titles = { voice: "我的风格", replies: "回复偏好", account: "账户与额度", ai: "AI 配置", behavior: "插件行为", data: "历史与数据", about: "关于插件" };
async function refreshAccount(force = false) {
  const account = await accountStates.getState({ force });
  $("account-status").textContent = accountStatusLabel(account);
  const detail = {
    guest: "注册并验证邮箱，即获 200 次永久有效的 AI 生成额度。",
    credits_available: "云端 AI 已连接；一次生成包含三种风格，只扣 1 次。",
    credits_exhausted: "生成次数已用完。可前往官网查看充值套餐，支付目前尚未开放。",
    frozen: "账户已暂停，请联系支持。",
    trial_active: "旧开发模拟状态；正式账户使用云端余额。",
    trial_exhausted: "旧开发模拟状态；正式账户不按天重置。",
    trial_expired: "旧开发模拟状态；正式账户按余额使用。",
    lifetime_active: "旧开发模拟状态；正式账户统一由云端 AI 提供。",
    auth_unavailable: "授权服务暂时不可用。你的本地设置和历史不会被清除。",
    developer_mode: "本地开发测试模式：继续使用你自己的 DeepSeek API Key。"
  };
  const serverDetails = [];
  if (account.source === "server" && account.user?.email) serverDetails.push(`当前账号：${account.user.email}`);
  if (account.source === "server" && account.trial?.expiresAt) serverDetails.push(`体验截止：${new Date(account.trial.expiresAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}（北京时间）`);
  if (account.source === "server" && account.license) serverDetails.push(`许可证：${({ active: "有效", revoked: "已撤销", expired: "已过期" })[account.license.licenseStatus] || "待确认"} · 已激活设备 ${account.license.activatedDevices ?? "—"} / ${account.license.maxDevices ?? "—"}`);
  $("account-detail").textContent = [detail[account.status], ...serverDetails].join("\n");
  $("account-quota").textContent = account.source === "server" && account.quota ? `免费剩余 ${account.quota.freeRemaining} 次 · 付费剩余 ${account.quota.paidRemaining} 次 · 共 ${account.quota.totalRemaining} 次` : "";
  const canUseOwnKey = account.status === "developer_mode" && RUNTIME_CONFIG.channel === "development";
  $("ai-mode-description").textContent = canUseOwnKey ? "本地开发测试：自带 API Key。" : "正式使用由官网云端 AI 提供，无需填写自己的 API Key。";
  $("settings-form").hidden = !canUseOwnKey;
  const hasToken = Boolean(await accountClient.token());
  $("account-login").hidden = hasToken && account.source === "server";
  $("account-logout").hidden = !hasToken;
  $("account-purchase").hidden = !hasToken;
  $("account-manage").hidden = !hasToken;
  if (RUNTIME_CONFIG.channel === "development") { $("dev-mock-box").hidden = hasToken; if (!hasToken) $("dev-mock-state").value = account.status; }
}
function showMessage(text, error = false) { message.textContent = text; message.className = `notice ${error ? "error" : "success"}`; }
function announceSettingsChanged() { void chrome.runtime.sendMessage({ type: "REPLY_COPILOT_SETTINGS_UPDATED" }).catch(() => {}); }
function profileFromForm() { return { ...profile, name: $("voice-name").value.trim(), tone: $("tone").value, interests: $("interests").value.split(/[，,]/).map((x) => x.trim()).filter(Boolean), customInstructions: $("instructions").value }; }
function renderSamples() {
  const list = $("samples"); list.replaceChildren();
  profile.writingSamples.forEach((sample, index) => { const li = document.createElement("li"), text = document.createElement("span"), remove = document.createElement("button"); text.textContent = sample; remove.textContent = "删除"; remove.className = "text-button"; remove.type = "button"; remove.addEventListener("click", async () => { profile = await profiles.removeWritingSample(index); renderSamples(); showMessage("已删除这条写作样本。"); announceSettingsChanged(); }); li.append(text, remove); list.append(li); });
}
function renderProfile(value) { profile = value; $("voice-name").value = value.name; $("tone").value = value.tone; $("interests").value = value.interests.join("，"); $("instructions").value = value.customInstructions; $("language").value = value.language; $("length").value = value.replyLength; $("humor").value = value.humorLevel; renderSamples(); }
async function saveProfileFields() { profile = await profiles.save({ ...profileFromForm(), language: $("language").value, replyLength: $("length").value, humorLevel: $("humor").value }); announceSettingsChanged(); }
async function refreshKey() { configuredKey = await storage.getApiKey(); state.textContent = configuredKey ? `Key 已保存（${configuredKey.slice(0, 3)}••••${configuredKey.slice(-4)}）` : "尚未配置 API Key"; }
async function refreshHostAccess() { try { const allowed = await chrome.permissions.contains({ origins: [DEEPSEEK_ORIGIN] }); hostAccess.textContent = allowed ? "DeepSeek 连接权限：已允许" : "DeepSeek 连接权限：Chrome 尚未允许，请检查扩展的网站访问权限"; hostAccess.classList.toggle("error", !allowed); return allowed; } catch { hostAccess.textContent = "暂时无法检查连接权限"; return false; } }
async function refreshUsage() {
  const summary = await usage.getSummary(), box = $("usage-summary"); box.replaceChildren();
  const rows = [["累计生成", summary.totalGenerations], ["最近 7 天", summary.last7DaysGenerations], ["切换候选", summary.selections], ["复制", summary.copies], ["有帮助", summary.feedbackGood], ["不太像我", summary.feedbackBad], ["请求失败", summary.apiFailures]];
  for (const [label, count] of rows) { const item = document.createElement("div"), value = document.createElement("strong"), title = document.createElement("span"); value.textContent = count; title.textContent = label; item.append(value, title); box.append(item); }
  const list = $("history-list"); list.replaceChildren();
  for (const item of await history.getRecent(30)) { const li = document.createElement("li"), p = document.createElement("p"), meta = document.createElement("small"); p.textContent = item.reply || "已选择的回复"; meta.textContent = `${item.style || "回复"} · ${new Date(item.updatedAt || item.createdAt).toLocaleString("zh-CN")}`; li.append(p, meta); list.append(li); }
  if (!list.childElementCount) list.textContent = "还没有已选择的回复记录。";
}
async function refreshSettings() {
  renderProfile(await profiles.get());
  const behavior = await storage.getBehaviorPreferences();
  $("default-style").value = behavior.defaultReplyMode; $("auto-generate").checked = behavior.autoGenerateOnReply; $("show-floating").checked = behavior.showFloatingWindow; $("remember-position").checked = behavior.rememberFloatingPosition;
  $("reply-style").value = await storage.getReplyStyle();
  $("model-name").textContent = DEFAULT_MODEL; await refreshKey(); await refreshUsage();
  await refreshAccount();
}

if (RUNTIME_CONFIG.channel === "development") {
  $("dev-mock-box").hidden = false;
  $("dev-mock-state").addEventListener("change", async (event) => {
    await writeDevMock(chrome.storage.local, event.target.value);
    accountStates.invalidate(); await refreshAccount(true);
    showMessage("开发测试状态已切换；这不是实际授权或额度。");
  });
}
let accountPollTimer = null;
async function pollAccountBinding() {
  try {
    if (await accountClient.pollDeviceAuthorization()) {
      clearInterval(accountPollTimer); accountPollTimer = null;
      accountStates.invalidate(); await refreshAccount(true);
      showMessage("官网账户已连接；账户与额度已同步。"); announceSettingsChanged();
    }
  } catch (error) { clearInterval(accountPollTimer); accountPollTimer = null; showMessage(error.message || "账户绑定失败。", true); }
}
function startAccountPolling() { if (accountPollTimer) clearInterval(accountPollTimer); accountPollTimer = setInterval(() => void pollAccountBinding(), 3000); void pollAccountBinding(); }
$("account-login").addEventListener("click", async () => {
  try { const code = await accountClient.beginDeviceAuthorization(); showMessage(`已打开官网。请登录并确认绑定，绑定码：${code}`); startAccountPolling(); }
  catch (error) { showMessage(error.message || "无法发起账户绑定。", true); }
});
$("account-logout").addEventListener("click", async () => {
  try { await accountClient.logout(); accountStates.invalidate(); await refreshAccount(true); showMessage("已退出插件账户，本地风格、历史和个人 Key 均已保留。"); announceSettingsChanged(); }
  catch (error) { accountStates.invalidate(); await refreshAccount(true); showMessage(`本地凭据已清除；远端注销未确认：${error.message}`, true); }
});
for (const [id, method] of [["account-purchase", "openPurchasePage"], ["account-manage", "openAccountPage"]]) {
  $(id).addEventListener("click", async () => { try { await accountClient[method](); } catch (error) { showMessage(error.message, true); } });
}
$("account-refresh").addEventListener("click", async () => { accountStates.invalidate(); await refreshAccount(true); showMessage("账户状态已重新检查。"); });

document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => {
  const target = button.dataset.panel; document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll(".settings-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `panel-${target}`)); $("page-title").textContent = titles[target];
}));
$("save-voice").addEventListener("click", async () => { try { await saveProfileFields(); showMessage("个人风格已保存在此浏览器。"); } catch (error) { showMessage(error.message || "保存失败，请检查输入。", true); } });
$("reset-voice").addEventListener("click", async () => { if (!confirm("确定恢复默认风格？当前个人风格设置将被替换。")) return; renderProfile(await profiles.reset()); showMessage("已恢复默认风格。"); announceSettingsChanged(); });
$("zane-voice").addEventListener("click", async () => { renderProfile(await profiles.save(createZaneVoiceProfile())); showMessage("已切换为 Zane 个人预设。"); announceSettingsChanged(); });
$("add-sample").addEventListener("click", async () => { try { profile = await profiles.addWritingSample($("sample-input").value); $("sample-input").value = ""; renderSamples(); showMessage("已添加写作样本。"); announceSettingsChanged(); } catch (error) { showMessage(error.message, true); } });
$("save-replies").addEventListener("click", async () => { try { await saveProfileFields(); await storage.setBehaviorPreferences({ defaultReplyMode: $("default-style").value }); await storage.setReplyStyle($("reply-style").value); showMessage("回复偏好已保存。"); announceSettingsChanged(); } catch (error) { showMessage(error.message || "保存失败。", true); } });
$("settings-form").addEventListener("submit", async (event) => { event.preventDefault(); const value = input.value.trim(); if (!value && !configuredKey) return showMessage("请先输入 DeepSeek API Key。", true); if (value) { await storage.setApiKey(value); input.value = ""; await refreshKey(); showMessage("API Key 已安全保存在本地扩展存储中。"); announceSettingsChanged(); } else showMessage("API Key 已经保存在此设备。"); });
$("toggle-key").addEventListener("click", () => { const visible = input.type === "text"; input.type = visible ? "password" : "text"; $("toggle-key").textContent = visible ? "显示" : "隐藏"; });
$("clear").addEventListener("click", async () => { if (!confirm("确定清除本地保存的 DeepSeek API Key？")) return; await storage.clearApiKey(); input.value = ""; await refreshKey(); $("connection-state").textContent = "尚未测试连接"; showMessage("API Key 已清除。"); announceSettingsChanged(); });
testButton.addEventListener("click", async () => { const key = input.value.trim() || configuredKey; if (!key) return showMessage("请先输入并保存 API Key。", true); if (!(await refreshHostAccess())) return showMessage("请在 Chrome 扩展的网站访问设置中允许 api.deepseek.com，然后重试。", true); testButton.disabled = true; $("connection-state").textContent = "正在测试连接…"; showMessage("正在测试连接…"); try { await testDeepSeekConnection(key); $("connection-state").textContent = "连接正常"; showMessage("DeepSeek 连接成功。"); } catch (error) { $("connection-state").textContent = "连接失败"; const text = /reach|network|fetch/i.test(error.message) ? "无法连接 DeepSeek，请检查网络、VPN、代理和扩展的网站访问权限。" : /key|unauthorized/i.test(error.message) ? "API Key 无效或未获授权，请检查后重试。" : "连接失败，请稍后重试并检查 API 配置。"; showMessage(text, true); } finally { testButton.disabled = false; } });
$("save-behavior").addEventListener("click", async () => { await storage.setBehaviorPreferences({ autoGenerateOnReply: $("auto-generate").checked, showFloatingWindow: $("show-floating").checked, rememberFloatingPosition: $("remember-position").checked, defaultReplyMode: $("default-style").value, ...( $("remember-position").checked ? {} : { floatingPosition: null }) }); showMessage("插件行为设置已保存。"); announceSettingsChanged(); });
$("reset-position").addEventListener("click", async () => { await storage.resetFloatingPosition(); showMessage("悬浮框位置已重置。"); announceSettingsChanged(); });
$("clear-history").addEventListener("click", async () => { if (!confirm("确定清空本地回复历史？此操作无法撤销。")) return; await history.clearHistory(); await refreshUsage(); showMessage("本地回复历史已清空。"); announceSettingsChanged(); });
$("clear-usage").addEventListener("click", async () => { if (!confirm("确定清除本地使用统计和反馈？此操作无法撤销。")) return; await usage.clear(); await refreshUsage(); showMessage("本地使用数据已清除。"); announceSettingsChanged(); });
$("reset-preferences").addEventListener("click", async () => { if (!confirm("确定重置个人风格、回复偏好和插件行为？API Key 和历史记录不会被删除。")) return; renderProfile(await profiles.reset()); await storage.setBehaviorPreferences({ autoGenerateOnReply: true, showFloatingWindow: true, rememberFloatingPosition: true, floatingPosition: null, defaultReplyMode: "natural" }); await storage.setReplyStyle("natural-friendly"); await refreshSettings(); showMessage("个人偏好已重置；API Key 和历史记录已保留。"); announceSettingsChanged(); });

chrome.storage.onChanged.addListener((changes, area) => { if (area !== "local") return; if ("replyCopilotAccountToken" in changes) { accountStates.invalidate(); void refreshAccount(true); } if (["voiceProfile", "behaviorPreferences", "replyStyleProfile", "deepseekApiKey", "replyHistory", "localUsageEvents"].some((key) => key in changes)) void refreshSettings(); });
void Promise.all([refreshSettings(), refreshHostAccess()]).catch(() => showMessage("读取本地设置失败，请重新打开设置页。", true));
void accountClient.hasPendingDeviceAuthorization().then((pending) => { if (pending) startAccountPolling(); });
