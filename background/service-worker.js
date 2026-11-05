import "../utils/generation-performance.js";
import { createReplyRequest } from "../domain/reply-request.js";
import { StorageService, API_KEY_KEY, HISTORY_KEY, ONBOARDING_COMPLETE_KEY } from "../services/storage-service.js";
import { AIProviderRouter } from "../services/ai-provider-router.js";
import { AccountStateService } from "../services/account-state-service.js";
import { accountStatusLabel } from "../domain/account-state.js";
import { ReplyEngine } from "../services/reply-engine.js";
import { HistoryService } from "../services/history-service.js";
import { VoiceProfileService } from "../services/voice-profile-service.js";
import { UsageService } from "../services/usage-service.js";
import { AccountClient, ACCOUNT_TOKEN_KEY } from "../services/account-client.js";
import { HostedAIClient } from "../services/hosted-ai-client.js";
import { parseAIOutput } from "../utils/output-parser.js";
import { DeliveryCoordinator } from "../services/delivery-coordinator.js";

let performanceEnabled = false;
const performanceSamples = globalThis.ReplyCopilotPerformance.createCollector();
globalThis.replyCopilotPerformanceReport = () => performanceSamples.report();
globalThis.clearReplyCopilotPerformance = () => performanceSamples.clear();
const performanceReady = chrome.storage.session.get("generationPerformanceEnabled").then(value => { performanceEnabled=value.generationPerformanceEnabled===true; }, () => {});
const MENU_ID = "generate-reply-copilot";
const storage = new StorageService();
const history = new HistoryService();
const profiles = new VoiceProfileService();
const usage = new UsageService();
const accountStates = new AccountStateService();
const accountClient = new AccountClient();
const deliveryCoordinator = new DeliveryCoordinator({
  storage: chrome.storage.local,
  getAccountId: async () => (await accountClient.fetchCurrentUser()).user?.userId,
  createClient: () => new HostedAIClient({ accountClient }),
});
const aiProvider = new AIProviderRouter({ accountStates, hostedFactory: () => deliveryCoordinator });
const activeRequests = new Map();
const generatedInputs = new Map();
let settingsOpenPromise = null;
let bindingPromise = null;
let lastBindingPoll = 0;
let pendingClaim = Promise.resolve();
let behaviorWrite = Promise.resolve();
const X_PAGE = /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)(?:\/|$)/;
const EXTENSION_PAGE = new RegExp(`^chrome-extension://${chrome.runtime.id}/`);
async function broadcastSettingsChanged() {
  const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
  await Promise.allSettled(tabs.filter((tab) => Number.isInteger(tab.id)).map((tab) => chrome.tabs.sendMessage(tab.id, { type: "REPLY_COPILOT_SETTINGS_CHANGED" })));
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.generationPerformanceEnabled) {
    performanceEnabled=changes.generationPerformanceEnabled.newValue===true;
    void chrome.tabs.query({url:["https://x.com/*","https://twitter.com/*"]}).then(tabs=>Promise.allSettled(tabs.filter(tab=>Number.isInteger(tab.id)).map(tab=>chrome.tabs.sendMessage(tab.id,{type:"REPLY_COPILOT_PERFORMANCE_STATE",enabled:performanceEnabled})))).catch(()=>{});
  }
  if (area === "local" && changes.behaviorPreferences) void broadcastSettingsChanged();
  if (area === "local" && changes.replyCopilotAccountToken) { accountStates.invalidate(); void broadcastSettingsChanged(); }
});

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });
    const old = await chrome.storage.local.get([API_KEY_KEY, HISTORY_KEY, ONBOARDING_COMPLETE_KEY, "replyCopilotWelcomeShown"]);
    await profiles.migrateLegacy({ apiKeyExists: Boolean(old[API_KEY_KEY]), historyExists: Boolean(old[HISTORY_KEY]?.length) });
    await storage.migrateSchema();
    // Remove the old DOM editing preference; the native input path is controlled per request.
    await storage.disableLegacyAutoFill();
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    if (!old[ONBOARDING_COMPLETE_KEY] && !old.replyCopilotWelcomeShown && ["install", "update"].includes(details.reason)) {
      await chrome.storage.local.set({ replyCopilotWelcomeShown: true });
      await chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
    }
  })();
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: "生成回复", contexts: ["selection"], documentUrlPatterns: ["https://x.com/*", "https://twitter.com/*"] });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  let request;
  try { request = createReplyRequest({ sourceText: info.selectionText || "", sourceUrl: info.pageUrl || tab?.url || "" }); }
  catch (error) { request = { requestId: crypto.randomUUID(), error: error.message, sourceUrl: info.pageUrl || tab?.url || "", createdAt: new Date().toISOString() }; }
  await storage.savePendingRequest(request);
  try { if (Number.isInteger(tab?.windowId)) await chrome.sidePanel.open({ windowId: tab.windowId }); }
  catch { await storage.savePendingRequest({ ...request, error: "Chrome could not open the side panel. Open it from the Extensions menu and try again." }); }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromXPage = X_PAGE.test(sender.url || sender.tab?.url || "");
  const fromExtensionPage = EXTENSION_PAGE.test(sender.url || "");
  if (message?.type === "REPLY_COPILOT_PERFORMANCE_STATE") {
    if ((!fromXPage || sender.frameId !== 0) && !fromExtensionPage) return false;
    void performanceReady.then(()=>sendResponse({enabled:performanceEnabled}));return true;
  }
  if (message?.type === "REPLY_COPILOT_PERFORMANCE_SAMPLE") {
    if (fromXPage && sender.frameId === 0 && performanceEnabled) performanceSamples.record(message.sample);
    sendResponse({ok:true});return false;
  }
  if (message?.type === "REPLY_COPILOT_OPEN_SETTINGS") {
    if (!fromXPage) { sendResponse({ ok: false }); return false; }
    if (!settingsOpenPromise) settingsOpenPromise = chrome.runtime.openOptionsPage().finally(() => { settingsOpenPromise = null; });
    void settingsOpenPromise.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_GET_BEHAVIOR") {
    if (!fromXPage && !fromExtensionPage) { sendResponse({ ok: false }); return false; }
    void storage.getBehaviorPreferences().then((preferences) => sendResponse({ ok: true, preferences }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_SET_AUTO_GENERATE") {
    if (!fromXPage || sender.frameId !== 0 || typeof message.enabled !== "boolean") { sendResponse({ ok: false }); return false; }
    behaviorWrite = behaviorWrite.catch(() => null).then(() => storage.setBehaviorPreferences({ autoGenerateOnReply: message.enabled }));
    void behaviorWrite.then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_ACCOUNT_STATE") {
    if ((!fromXPage || sender.frameId !== 0) && !fromExtensionPage) { sendResponse({ ok: false }); return false; }
    void (async () => {
      const pending = await accountClient.hasPendingDeviceAuthorization();
      if (pending && Date.now() - lastBindingPoll > 2500) {
        lastBindingPoll = Date.now();
        try { if (await accountClient.pollDeviceAuthorization()) accountStates.invalidate(); } catch (error) { if (!/已过期/.test(error?.message || "")) throw error; }
      }
      const state = await accountStates.getState({ force: pending });
      const recoveryRequired=state.status==='credits_exhausted' && ['running','ready','expired'].includes((await new HostedAIClient({accountClient}).recoverGeneration().catch(()=>({state:'unknown'}))).state);
      sendResponse({ ok: true, recoveryRequired, status: state.status, source: state.source, quota: state.quota, pending: await accountClient.hasPendingDeviceAuthorization(), ...(fromExtensionPage ? { user: state.user ? { username: state.user.username, email: state.user.email } : null } : {}) });
    })().catch(() => sendResponse({ ok: false, status: "auth_unavailable" }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_BEGIN_BINDING") {
    if ((!fromXPage || sender.frameId !== 0) && !fromExtensionPage || !["register", "login"].includes(message.mode)) { sendResponse({ ok: false }); return false; }
    if (!bindingPromise) bindingPromise = (async () => {
      if (await accountClient.token()) {
        const state = await accountStates.getState({ force: true });
        if (state.status === "auth_expired") { await chrome.storage.local.remove(ACCOUNT_TOKEN_KEY); accountStates.invalidate(); }
      }
      return accountClient.beginDeviceAuthorization({ mode: message.mode });
    })().finally(() => { bindingPromise = null; });
    void bindingPromise.then((deviceCode) => sendResponse({ ok: true, deviceCode }), (error) => sendResponse({ ok: false, error: error?.message || "无法发起绑定。" }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_OPEN_PRICING") {
    if (!fromXPage || sender.frameId !== 0) { sendResponse({ ok: false }); return false; }
    void accountClient.openPurchasePage().then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_CLAIM_PENDING") {
    if (!fromExtensionPage || !sender.url?.endsWith("/sidepanel/sidepanel.html")) { sendResponse({ ok: false }); return false; }
    pendingClaim = pendingClaim.catch(() => null).then(async () => {
      const request = await storage.getPendingRequest();
      await chrome.storage.session.remove("pendingReplyRequest");
      const createdAt = Date.parse(request?.createdAt || "");
      if (!request || !Number.isFinite(createdAt) || Date.now() - createdAt > 30_000 || Date.now() < createdAt - 5000) return null;
      return request;
    });
    void pendingClaim.then((request) => sendResponse({ ok: true, request }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_SET_FLOATING_POSITION") {
    if (!fromXPage || !Number.isFinite(message.left) || !Number.isFinite(message.top)) { sendResponse({ ok: false }); return false; }
    void storage.getBehaviorPreferences().then(async (preferences) => {
      if (preferences.rememberFloatingPosition) await storage.setBehaviorPreferences({ floatingPosition: { left: Math.max(0, Math.min(message.left, 10000)), top: Math.max(0, Math.min(message.top, 10000)) } });
      sendResponse({ ok: true });
    }, () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_SETTINGS_UPDATED") {
    if (!fromExtensionPage) { sendResponse({ ok: false }); return false; }
    void broadcastSettingsChanged();
    sendResponse({ ok: true }); return false;
  }
  if(message?.type === "REPLY_COPILOT_RECOVER_GENERATION"){
    if((!fromXPage&&!fromExtensionPage)||typeof message.abandon!=='boolean'){sendResponse({ok:false});return false;}
    void deliveryCoordinator.recoverPending({abandon:message.abandon}).then(state=>{accountStates.invalidate();return sendResponse({ok:true,...state,...(state.raw?{result:parseAIOutput(state.raw),raw:undefined}:{})});},error=>sendResponse({ok:false,error:error?.message||'恢复失败，请重试。',code:error?.code||'NETWORK_ERROR'}));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_GENERATE") {
    if (!fromXPage || typeof message.requestId !== "string" || typeof message.sourceText !== "string" || message.sourceText.length > 12000 || !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(message.sourceUrl || "")) { sendResponse({ ok: false, error: "无法验证当前帖子。请打开侧边栏重试。" }); return false; }
    void (async () => {
      const trace = globalThis.ReplyCopilotPerformance.createTrace({enabled:performanceEnabled && message.performanceEnabled===true});
      const controller = new AbortController(); activeRequests.get(message.requestId)?.abort(); activeRequests.set(message.requestId, controller);
      try {
        const [voiceProfile, replyStyle] = await trace.measure("background_prepare",()=>Promise.all([profiles.get(),storage.getReplyStyle()]));
        const engine = new ReplyEngine({ aiClient: aiProvider, historyService: history });
        const result = await engine.generateReplies({ postContext: { text: message.sourceText, url: message.sourceUrl }, voiceProfile, requestId: message.requestId }, { replyStyle, signal: controller.signal, performanceTrace: trace.enabled ? trace : undefined });
        if (controller.signal.aborted) throw new Error("这条生成请求已取消。");
        // Local history is best effort: a storage failure must not discard a usable AI draft.
        // Keep writes awaited for MV3 suspension safety; overlap the independent
        // account label lookup instead of dropping persistence after sendResponse.
        const [,accountLabel] = await Promise.all([
          trace.measure("local_bookkeeping",()=>Promise.allSettled([history.recordGeneration({ requestId: message.requestId, result }), usage.track("generated", { requestId: message.requestId })])),
          trace.measure("account_label",()=>accountStates.getState().then(accountStatusLabel, () => "授权状态暂时无法确认")),
        ]);
        if (controller.signal.aborted) throw new Error("这条生成请求已取消。");
        if (Number.isInteger(sender.tab?.id)) {
          generatedInputs.set(message.requestId, { tabId: sender.tab.id, replies: result.replies });
          setTimeout(() => generatedInputs.delete(message.requestId), 120_000);
        }
        const sample = trace.snapshot("success");
        if(sample) sample.durations.background_total=sample.elapsedMs;
        sendResponse({ ok: true, result, accountLabel, ...(sample ? {performance:sample} : {}) });
      } catch (error) {
        if (!controller.signal.aborted) void usage.track("api_failure", { requestId: message.requestId }).catch(() => {});
        const sample = trace.snapshot(controller.signal.aborted ? "cancelled" : "failed");
        if(sample) sample.durations.background_total=sample.elapsedMs;
        sendResponse({ ok: false, error: error?.message || "生成失败，请打开侧边栏重试。", ...(typeof error?.code === "string" ? { code: error.code } : {}), ...(sample ? {performance:sample} : {}) });
      } finally { if (activeRequests.get(message.requestId) === controller) activeRequests.delete(message.requestId); }
    })();
    return true;
  }
  if (message?.type === "REPLY_COPILOT_CANCEL") { if (fromXPage && typeof message.requestId === "string") { activeRequests.get(message.requestId)?.abort(); generatedInputs.delete(message.requestId); } sendResponse({ ok: true }); return false; }
  if (message?.type === "REPLY_COPILOT_HISTORY") {
    if (!fromXPage || !["selected", "copied", "applied", "manually_confirmed"].includes(message.event)) { sendResponse({ ok: false }); return false; }
    void Promise.all([history.recordEvent(message.requestId, message.event, { style: message.style, reply: message.reply }), usage.track(message.event, { requestId: message.requestId, style: message.style })]).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_FEEDBACK") {
    if (!fromXPage || !["good", "not_my_style"].includes(message.feedback)) { sendResponse({ ok: false }); return false; }
    void usage.track(message.feedback === "good" ? "feedback_good" : "feedback_bad", { requestId: message.requestId, style: message.style }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_OPEN_SIDEPANEL") {
    if (!fromXPage || !Number.isInteger(sender.tab?.windowId)) { sendResponse({ ok: false }); return false; }
    void (async () => {
      if (typeof message.sourceText === "string" && message.sourceText.length > 0 && message.sourceText.length <= 12000 && /^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(message.sourceUrl || "")) {
        try { await storage.savePendingRequest(createReplyRequest({ sourceText: message.sourceText, sourceUrl: message.sourceUrl })); } catch { /* open panel without unverified context */ }
      }
      try { await chrome.sidePanel.open({ windowId: sender.tab.windowId }); sendResponse({ ok: true }); } catch { sendResponse({ ok: false }); }
    })();
    return true;
  }
  return false;
});
