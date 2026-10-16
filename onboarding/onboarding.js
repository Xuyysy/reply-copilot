import { VoiceProfileService } from "../services/voice-profile-service.js";
import { StorageService, ONBOARDING_COMPLETE_KEY } from "../services/storage-service.js";
import { testDeepSeekConnection } from "../services/deepseek-client.js";
import { RUNTIME_CONFIG } from "../config/runtime.js";
const profiles = new VoiceProfileService(), storage = new StorageService();
const sections = [...document.querySelectorAll("[data-step]")], indicators = [...document.querySelectorAll(".steps span")];
let step = 0, profile = await profiles.get();
const $ = (id) => document.getElementById(id);
if ($("dev-setup")) $("dev-setup").hidden = RUNTIME_CONFIG.channel !== "development";
let bindingBusy = false;
async function refreshConnection() {
  const result = await chrome.runtime.sendMessage({ type: "REPLY_COPILOT_ACCOUNT_STATE" }).catch(() => null);
  const connected = result?.ok && result.source === "server" && ["credits_available", "credits_exhausted", "frozen"].includes(result.status);
  $("welcome-actions").classList.toggle("hidden", connected || Boolean(result?.pending));
  $("connected-actions").classList.toggle("hidden", !connected);
  $("welcome-status").textContent = connected ? `账户已成功连接。${result.quota ? `剩余 ${result.quota.totalRemaining} 次。` : ""}` : result?.pending ? "正在等待官网确认。请完成授权，本页会自动更新。" : result?.status === "auth_expired" ? "登录已过期。请在设置中心切换账户后重新连接。" : result?.status === "auth_unavailable" || !result?.ok ? "暂时无法连接账户服务，请稍后重试。" : "注册验证邮箱后领取 200 次，或登录已有账户。";
}
setInterval(() => void refreshConnection(), 3500);
chrome.storage.onChanged.addListener((changes, area) => { if (area === "local" && changes.replyCopilotAccountToken) void refreshConnection(); });
function show() { sections.forEach((section, index) => section.classList.toggle("hidden", index !== step)); indicators.forEach((dot, index) => dot.classList.toggle("active", index <= step)); }
function readVoice() { profile = { ...profile, tone: $("tone").value, language: $("language").value, replyLength: $("length").value, humorLevel: $("humor").value }; }
async function finish() { if (step === 1) readVoice(); await profiles.save(profile); await chrome.storage.local.set({ [ONBOARDING_COMPLETE_KEY]: true }); $("status").textContent = "设置已保存，现在可以使用 x-Reply-Helper。"; if (step !== 2) { step = 2; show(); } }
document.addEventListener("click", async (event) => {
  const button = event.target.closest("button"); if (!button) return;
  if (["open-login", "open-register"].includes(button.id)) { if (bindingBusy) return; bindingBusy = true; try { const result = await chrome.runtime.sendMessage({ type: "REPLY_COPILOT_BEGIN_BINDING", mode: button.id === "open-register" ? "register" : "login" }); $("welcome-status").textContent = result?.ok ? "已打开官网，请登录并确认绑定。" : result?.error || "无法发起绑定。"; await refreshConnection(); } catch { $("welcome-status").textContent = "暂时无法发起绑定，请重试。"; } finally { bindingBusy = false; } return; }
  if (button.id === "open-options") { chrome.runtime.openOptionsPage(); return; }
  if (button.id === "start-using") { await chrome.storage.local.set({ [ONBOARDING_COMPLETE_KEY]: true }); window.close(); return; }
  if (button.id === "dev-setup") { step = 1; show(); return; }
  if (button.hasAttribute("data-next")) { if (step === 0) { step = 1; show(); return; } readVoice(); await profiles.save(profile); step = 2; show(); }
  if (button.hasAttribute("data-back")) { if (step === 1) step = 0; else if (step === 2) step = 1; show(); }
  if (button.hasAttribute("data-skip")) { if (step === 1) { readVoice(); await profiles.save(profile); } await chrome.storage.local.set({ [ONBOARDING_COMPLETE_KEY]: true }); window.close(); }
  if (button.id === "save-key") { const key = $("api-key").value.trim(); if (!key) { $("status").textContent = "请先输入 DeepSeek API Key。"; return; } await storage.setApiKey(key); $("api-key").value = ""; $("status").textContent = "API Key 已保存在此设备。"; }
  if (button.id === "test-key") { const key = $("api-key").value.trim() || await storage.getApiKey(); if (!key) { $("status").textContent = "请先输入并保存 API Key。"; return; } button.disabled = true; $("status").textContent = "正在测试连接…"; try { await testDeepSeekConnection(key); $("status").textContent = "连接成功。"; } catch (error) { $("status").textContent = /reach|network|fetch/i.test(error.message) ? "无法连接 DeepSeek，请检查网络和扩展的网站访问权限。" : /key|unauthorized/i.test(error.message) ? "API Key 无效或未获授权，请检查后重试。" : "连接失败，请检查设置后重试。"; } finally { button.disabled = false; } }
  if (button.id === "finish") { await finish(); if ($("status").textContent.startsWith("设置已保存")) window.close(); }
});
show();
void refreshConnection();
