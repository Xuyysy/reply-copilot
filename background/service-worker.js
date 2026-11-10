import { openReplySidePanel } from '../services/open-sidepanel.js';
import { RUNTIME_CONFIG } from "../config/runtime.js";
import {createMomentumView} from '../services/momentum-view.js';
import {MomentumStore,momentumReceiptPatch,momentumReceiptKey,momentumGateKey,createMomentumMutationQueue} from '../services/creator-momentum.js';
import "../utils/generation-performance.js";
import { StorageService, API_KEY_KEY, HISTORY_KEY, ONBOARDING_COMPLETE_KEY } from "../services/storage-service.js";
import { AIProviderRouter } from "../services/ai-provider-router.js";
import { AccountStateService } from "../services/account-state-service.js";
import { accountStatusLabel } from "../domain/account-state.js";
import { ReplyEngine } from "../services/reply-engine.js";
import { HistoryService } from "../services/history-service.js";
import { VoiceProfileService } from "../services/voice-profile-service.js";
import {generatedHistory,generatedUsage} from "../services/generation-records.js";
import { UsageService, USAGE_KEY } from "../services/usage-service.js";
import { matchesBindingSender } from "../services/binding-bridge.js";
import { AccountClient, ACCOUNT_TOKEN_KEY, ACCOUNT_PENDING_DEVICE_KEY, ACCOUNT_BINDING_RECEIPT_KEY } from "../services/account-client.js";
import { HostedAIClient } from "../services/hosted-ai-client.js";
import { parseAIOutput } from "../utils/output-parser.js";
import { DeliveryCoordinator } from "../services/delivery-coordinator.js";

let performanceEnabled = false;
const performanceSamples = globalThis.ReplyCopilotPerformance.createCollector();
globalThis.replyCopilotPerformanceReport = () => performanceSamples.report();
globalThis.clearReplyCopilotPerformance = () => performanceSamples.clear();
const performanceReady = chrome.storage.session.get("generationPerformanceEnabled").then(value => { performanceEnabled=value.generationPerformanceEnabled===true; }, () => {});
const storage = new StorageService();
const history = new HistoryService();
const profiles = new VoiceProfileService();
const usage = new UsageService();
const accountStates = new AccountStateService();
const accountClient = new AccountClient();
const momentum=new MomentumStore();
const momentumView=createMomentumView({accountStates,client:accountClient,momentum,storage:chrome.storage.local,broadcast:broadcastMomentum});
async function broadcastMomentum() {
  const message = {type: 'REPLY_COPILOT_MOMENTUM_CHANGED'};
  await Promise.allSettled([
    chrome.runtime.sendMessage?.(message),
    // A URL filter silently omits X tabs when Chrome withholds Tab.url.
    chrome.tabs.query({}).then(tabs => Promise.allSettled(tabs
      .filter(tab => Number.isInteger(tab.id) && (!tab.url || X_PAGE.test(tab.url)))
      .map(tab => chrome.tabs.sendMessage(tab.id, message, {frameId:0}))))
  ]);
}

const deliveryCoordinator = new DeliveryCoordinator({
  storage: chrome.storage.local,
  getAccountId: () => accountStates.getOwnerId(),
  createClient: () => new HostedAIClient({ accountClient }),
  completion:{recovered:async receipt=>{const key=momentumReceiptKey(receipt.ownerId,receipt.input.requestId),old=await chrome.storage.local.get(key);await chrome.storage.local.set(momentumReceiptPatch(receipt,momentumView.policyFor(receipt.ownerId),old[key]));},keys:record=>[HISTORY_KEY,USAGE_KEY,momentumReceiptKey(record.ownerId,record.input.requestId)],patch:(data,receipt)=>{
    const meta={requestId:receipt.input.requestId,recommendation:JSON.parse(receipt.raw).recommendation,createdAt:new Date().toISOString()};
    return {...momentumReceiptPatch(receipt,momentumView.policyFor(receipt.ownerId),data[momentumReceiptKey(receipt.ownerId,receipt.input.requestId)]),[HISTORY_KEY]:generatedHistory(data[HISTORY_KEY]||[],meta),[USAGE_KEY]:generatedUsage(data[USAGE_KEY]||[],meta)};
  },fallback:async(record,raw,receipt)=>{if(raw)await Promise.allSettled([history.recordGeneration({requestId:record.input.requestId,result:JSON.parse(raw),acknowledgedOwner:record.ownerId,acknowledgedAt:receipt?.completedAt??Date.now(),momentumPolicy:momentumView.policyFor(record.ownerId)}),usage.track('generated',{requestId:record.input.requestId})]);}},
});
const aiProvider = new AIProviderRouter({ accountStates, hostedFactory: () => deliveryCoordinator });
const activeRequests = new Map();
const generatedInputs = new Map();
let settingsOpenPromise = null;
let bindingPromise = null;
async function checkBinding() {
  try {
    const pending = await accountClient.hasPendingDeviceAuthorization();
    if (pending && !(await accountClient.pollDeviceAuthorization())) return {status:"waiting_website"};
    if (pending) accountStates.invalidate();
    if (!(await accountClient.token())) return {status:"invalid"};
    const account = await accountStates.getState({force:true});
    return {status:account.source === "server" && account.user?.userId ? "connected" : "account_unavailable", owner:account.user?.userId};
  } catch (error) {
    if (error?.code === "DEVICE_CODE_EXPIRED") return {status:"expired"};
    if (["DEVICE_CODE_USED","INVALID_DEVICE_TOKEN"].includes(error?.code)) return {status:"invalid"};
    return {status:"network_error"};
  }
}
chrome.runtime.onMessageExternal?.addListener((message,sender,respond)=>{
  if (!["XRH_BINDING_VERIFY","XRH_BINDING_STATUS"].includes(message?.type)) return false;
  void (async()=>{
    const local=await chrome.storage.local.get([ACCOUNT_PENDING_DEVICE_KEY,ACCOUNT_BINDING_RECEIPT_KEY,ACCOUNT_TOKEN_KEY]);
    const matches=record=>matchesBindingSender({sender,message,record,websiteUrl:RUNTIME_CONFIG.websiteUrl});
    const pending=matches(local[ACCOUNT_PENDING_DEVICE_KEY]);
    const receipt=local[ACCOUNT_BINDING_RECEIPT_KEY];
    if (message.type==="XRH_BINDING_VERIFY") return {status:pending&&!local[ACCOUNT_TOKEN_KEY]?"verified":"unavailable"};
    if (!pending && !(matches(receipt) && receipt.token===local[ACCOUNT_TOKEN_KEY])) return {status:"unavailable"};
    const result=await checkBinding();
    return {status:result.status==="connected" && result.owner!==message.userId?"account_mismatch":result.status};
  })().then(respond,()=>respond({status:"network_error"}));
  return true;
});
let lastBindingPoll = 0;
let behaviorWrite = Promise.resolve();
// Serialize momentum mutations across the floating window, independent X entry,
// and side panel. The last message received by the worker is the final intent.
const runMomentumMutation = createMomentumMutationQueue();
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
  if (area === "local" && changes.replyCopilotAccountToken) { momentumView.invalidate(); accountStates.invalidate(); void broadcastSettingsChanged(); void broadcastMomentum(); }
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
  // Remove the legacy selected-text AI action. Replies are generated only from
  // the post-bound X composer flow, so opening the side panel cannot spend credits.
  chrome.contextMenus.removeAll();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const fromXPage = X_PAGE.test(sender.url || sender.tab?.url || "");
  const fromExtensionPage = EXTENSION_PAGE.test(sender.url || "");
  if (message?.type === 'REPLY_COPILOT_MOMENTUM') {
    if((!fromXPage||sender.frameId!==0)&&!fromExtensionPage)return false;
    if(message.enabled!==undefined&&typeof message.enabled!=='boolean')return false;
    const mutating = typeof message.enabled === 'boolean' || message.dnd === true || Boolean(message.presented);
    const operation = mutating ? runMomentumMutation(() => momentumView(message)) : momentumView(message);
    void operation.then(value=>sendResponse({ok:true,...value}),()=>sendResponse({ok:false,status:'unverified',available:false,eligible:false,enabled:false}));return true;
  }
  if (message?.type === 'REPLY_COPILOT_OPEN_ORIGINAL') {
    if ((!fromXPage || sender.frameId !== 0) && !fromExtensionPage) return false;
    void chrome.tabs.create({url:'https://x.com/compose/post'}).then(()=>sendResponse({ok:true}),()=>sendResponse({ok:false}));return true;
  }
  if (message?.type === "REPLY_COPILOT_PERFORMANCE_CONTROL") {
    if (!fromExtensionPage || RUNTIME_CONFIG.channel !== "staging") { sendResponse({ok:false});return false; }
    void (async()=>{
      await performanceReady;
      if(typeof message.enabled === "boolean"){
        await chrome.storage.session.set({generationPerformanceEnabled:message.enabled});
        performanceEnabled=message.enabled;
      }
      if(message.clear===true)performanceSamples.clear();
      sendResponse({ok:true,enabled:performanceEnabled,report:performanceSamples.report()});
    })().catch(()=>sendResponse({ok:false}));return true;
  }
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
  if (message?.type === "REPLY_COPILOT_CHECK_BINDING") {
    if (!fromExtensionPage) { sendResponse({ok:false}); return false; }
    void checkBinding().then(({status})=>sendResponse({ok:true,status}));
    return true;
  }
  if (message?.type === "REPLY_COPILOT_ACCOUNT_STATE") {
    if ((!fromXPage || sender.frameId !== 0) && !fromExtensionPage) { sendResponse({ ok: false }); return false; }
    void (async () => {
      // Read the existing auth/pending keys once. When the account cache is
      // warm, fetch the owner-scoped reply-gate hint in parallel with this
      // already-required read, so the normal reply fast path adds no serial IO.
      const localAuth = await chrome.storage.local.get([ACCOUNT_TOKEN_KEY, ACCOUNT_PENDING_DEVICE_KEY]);
      let pending = Boolean(localAuth[ACCOUNT_PENDING_DEVICE_KEY]?.deviceToken);
      const cachedState = accountStates.peekState();
      const cachedOwner = !pending && localAuth[ACCOUNT_TOKEN_KEY] &&
        accountStates.cachedToken === localAuth[ACCOUNT_TOKEN_KEY] ? cachedState?.user?.userId : null;
      const cachedGateKey = fromXPage && cachedOwner ? momentumGateKey(cachedOwner) : null;
      const cachedGatePromise = cachedGateKey ? chrome.storage.local.get(cachedGateKey) : null;
      if (pending && Date.now() - lastBindingPoll > 2500) {
        lastBindingPoll = Date.now();
        try { if (await accountClient.pollDeviceAuthorization()) { accountStates.invalidate(); pending = false; } }
        catch (error) { if (["DEVICE_CODE_EXPIRED","DEVICE_CODE_USED","INVALID_DEVICE_TOKEN"].includes(error?.code)) pending = false; else throw error; }
      }
      const state = await accountStates.getState({ force: pending });
      const recoveryRequired=state.status==='credits_exhausted' && ['running','ready','expired'].includes((await new HostedAIClient({accountClient}).recoverGeneration().catch(()=>({state:'unknown'}))).state);
      const owner=state.user?.userId;
      let gateHint = false;
      if (fromXPage && owner) {
        const gateKey = momentumGateKey(owner);
        const stored = cachedOwner === owner && cachedGatePromise
          ? await cachedGatePromise.catch(() => ({})) : await chrome.storage.local.get(gateKey).catch(() => ({}));
        gateHint = Boolean(stored[gateKey]);
      }
      sendResponse({ ok: true, recoveryRequired, status: state.status, source: state.source, quota: state.quota, pending, ...(fromXPage?{momentumGatePending:gateHint}:{}), ...(fromExtensionPage ? { subscription: state.subscription ?? null, user: state.user ? { username: state.user.username, email: state.user.email } : null } : {}) });
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
        const [voiceProfile, replyStyle, generationContext] = await trace.measure("background_prepare",()=>Promise.all([profiles.get(),storage.getReplyStyle(),history.getGenerationContext(20)]));
        const engine = new ReplyEngine({ aiClient: aiProvider, historyService: history });
        const result = await engine.generateReplies({ postContext: { text: message.sourceText, url: message.sourceUrl }, voiceProfile, recentHistory:generationContext.recentHistory, requestId: message.requestId }, { styleStats:generationContext.styleStats, replyStyle, signal: controller.signal, performanceTrace: trace.enabled ? trace : undefined });
        if (controller.signal.aborted) throw new Error("这条生成请求已取消。");
        // ACK + receipt/history/usage have already been durably awaited together.
        // Labels are display-only: never start a refresh before returning a draft.
        const labelStarted=performance.now();
        const accountLabel=accountStatusLabel(accountStates.peekState()||{});
        trace.addDurations({account_label:performance.now()-labelStarted});
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
    if (!fromXPage || sender.frameId !== 0 || !Number.isInteger(sender.tab?.windowId)) {
      sendResponse({ok:false, error:"无法识别当前 X 标签页。"});
      return false;
    }
    void openReplySidePanel(() => chrome.sidePanel.open({windowId:sender.tab.windowId}), async () => {
      if (message.momentumDetails === true) {
        await chrome.storage.session.set({openMomentumDetails:true});
      }
    }).then(sendResponse);
    return true;
  }
  return false;
});

export {momentum, momentumView, accountStates, accountClient};
