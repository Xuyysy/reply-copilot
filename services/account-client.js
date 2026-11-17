import { RUNTIME_CONFIG } from "../config/runtime.js";

export const ACCOUNT_TOKEN_KEY = "replyCopilotAccountToken";
export const ACCOUNT_DEVICE_ID_KEY = "replyCopilotDeviceId";
export const ACCOUNT_BINDING_RECEIPT_KEY = "replyCopilotBindingReceipt";
export const ACCOUNT_PENDING_DEVICE_KEY = "replyCopilotPendingDevice";

function allowedOrigin(raw, config) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || (config.channel === "development" && url.protocol === "http:" && config.allowedHttpHosts?.includes(url.hostname));
  } catch { return false; }
}

export class AccountClient {
  constructor({ config = RUNTIME_CONFIG, storage = globalThis.chrome?.storage?.local, fetchImpl = fetch, openTab = (url) => chrome.tabs.create({ url }), updateTab = globalThis.chrome?.tabs?.update?.bind(globalThis.chrome.tabs) } = {}) { this.config = config; this.storage = storage; this.fetchImpl = fetchImpl; this.openTab = openTab; this.updateTab = updateTab; }
  websiteUrl(path) {
    if (!this.config.websiteUrl || !allowedOrigin(this.config.websiteUrl, this.config)) return null;
    try { const url = new URL(path, this.config.websiteUrl); return url.origin === new URL(this.config.websiteUrl).origin ? url.href : null; }
    catch { return null; }
  }
  async openWebsite(path) { const url = this.websiteUrl(path); if (!url) throw new Error("官网尚未配置，请稍后再试。"); return this.openTab(url); }
  openLoginPage(mode = "login") { return this.openWebsite(mode === "register" ? "/login?mode=register" : "/login"); }
  openAccountPage() { return this.openWebsite("/account"); }
  openPurchasePage() { return this.openWebsite("/pricing"); }
  async token() { return (await this.storage.get(ACCOUNT_TOKEN_KEY))[ACCOUNT_TOKEN_KEY] || ""; }
  async request(path, { method = "GET", body, signal, authenticate = true, expectedToken } = {}) {
    if (!this.config.hostedApiUrl || !allowedOrigin(this.config.hostedApiUrl, this.config)) throw new Error("云端 AI 服务尚未配置。");
    const token = authenticate ? await this.token() : "";
    if (expectedToken !== undefined && token !== expectedToken) throw Object.assign(new Error('账户已切换。'),{code:'AUTH_REQUIRED'});
    if (authenticate && !token) throw Object.assign(new Error("请先登录。"), { code: "AUTH_REQUIRED" });
    const url = new URL(path, this.config.hostedApiUrl);
    if (url.origin !== new URL(this.config.hostedApiUrl).origin) throw new Error("云端服务地址无效。");
    const controller=signal?null:new AbortController();
    const timer=controller?setTimeout(()=>controller.abort(),10000):null;
    const requestSignal=signal||controller.signal;
    try {
    let response;
    try { response = await Reflect.apply(this.fetchImpl, globalThis, [url.href, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", ...(body?.requestId ? { "Idempotency-Key": body.requestId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal:requestSignal }]); }
    catch (error) { if (requestSignal.aborted || error?.name === "AbortError") throw Object.assign(new Error("云端请求已超时或取消。"), { code: "NETWORK_ERROR" }); throw Object.assign(new Error("云端服务暂时无法连接，请稍后重试。"), { code: "NETWORK_ERROR" }); }
    let data; try { data = await response.json(); } catch { throw new Error("云端服务返回内容无效。"); }
    if (!response.ok) throw Object.assign(new Error(data?.message || "云端服务暂时不可用。"), { code: data?.code || "SERVER_UNAVAILABLE", status: response.status });
    return data;
    } finally {if(timer)clearTimeout(timer);}
  }
  fetchBootstrap() { return this.request("/v1/extension/bootstrap"); }
  fetchCurrentUser() { return this.request("/v1/me"); }
  fetchEntitlement() { return this.request("/v1/entitlements"); }
  fetchUsage() { return this.request("/v1/usage"); }
  refreshEntitlement() { return this.fetchEntitlement(); }
  async beginDeviceAuthorization({ mode = "login" } = {}) {
    if (await this.token()) throw new Error("账户已连接。如需切换账号，请先在设置中心退出当前账户。");
    const pending = (await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY];
    if (pending?.deviceToken && pending?.deviceCode && Date.parse(pending.expiresAt || "") > Date.now()) {
      await this.openBindingTab(pending);
      return pending.deviceCode;
    }
    const saved = await this.storage.get(ACCOUNT_DEVICE_ID_KEY);
    const deviceId = saved[ACCOUNT_DEVICE_ID_KEY] || crypto.randomUUID();
    await this.storage.set({ [ACCOUNT_DEVICE_ID_KEY]: deviceId });
    const data = await this.request("/v1/extension/device-code", { method: "POST", authenticate: false, body: { deviceId } });
    if (!/^[A-F0-9]{8}$/.test(data?.deviceCode || "") || !/^[a-f0-9]{64}$/.test(data?.deviceToken || "")) throw new Error("绑定请求返回内容无效。");
    await this.openBindingTab(data);
    return data.deviceCode;
  }
  async openBindingTab({deviceToken, deviceCode, expiresAt}) {
    const path = `/account?device_code=${deviceCode}`;
    if (!this.updateTab || !["staging","production"].includes(this.config.channel)) {
      await this.storage.set({[ACCOUNT_PENDING_DEVICE_KEY]:{deviceToken,deviceCode,expiresAt}});
      await this.openWebsite(path);
      return;
    }
    const proof = crypto.randomUUID();
    const url = this.websiteUrl(`${path}#binding=${proof}`);
    if (!url) throw new Error("官网尚未配置，请稍后再试。");
    const tab = await this.openTab("about:blank");
    if (!Number.isInteger(tab?.id)) throw new Error("无法打开绑定页面。");
    await this.storage.set({[ACCOUNT_PENDING_DEVICE_KEY]:{deviceToken,deviceCode,expiresAt,proof,tabId:tab.id}});
    await this.updateTab(tab.id,{url});
  }
  pollDeviceAuthorization() {
    if (!this.bindingPoll) this.bindingPoll = this.exchangePending().finally(() => { this.bindingPoll = null; });
    return this.bindingPoll;
  }
  async exchangePending() {
    const pending = (await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY];
    if (!pending?.deviceToken) return false;
    if (!(Date.parse(pending.expiresAt || "") > Date.now())) throw Object.assign(new Error("绑定码已过期，请重新登录。"), {code:"DEVICE_CODE_EXPIRED"});
    let data;
    try {
      data = await this.request("/v1/extension/exchange", { method: "POST", authenticate: false, body: { deviceToken: pending.deviceToken } });
    } catch (error) {
      if (["DEVICE_CODE_USED","INVALID_DEVICE_TOKEN"].includes(error?.code)) {
        const current = (await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY];
        if (current?.deviceToken === pending.deviceToken) await this.storage.remove(ACCOUNT_PENDING_DEVICE_KEY);
      }
      throw error;
    }
    if (data?.status === "pending") return false;
    if (data?.status !== "approved" || !/^[a-f0-9]{64}$/.test(data?.accessToken || "")) throw new Error("绑定结果无效。");
    const current = (await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY];
    if (current?.deviceToken !== pending.deviceToken) return false;
    const {deviceCode, proof, tabId, expiresAt} = current;
    await this.storage.set({
      [ACCOUNT_TOKEN_KEY]: data.accessToken,
      [ACCOUNT_PENDING_DEVICE_KEY]: null,
      [ACCOUNT_BINDING_RECEIPT_KEY]: {deviceCode, proof:proof ?? null, tabId:tabId ?? null, expiresAt, token:data.accessToken},
    });
    return true;
  }
  async hasPendingDeviceAuthorization() { return Boolean((await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY]?.deviceToken); }
  async logout() {
    try { if (await this.token()) await this.request("/v1/auth/logout", { method: "POST", body: {} }); }
    finally { await this.storage.remove([ACCOUNT_TOKEN_KEY, ACCOUNT_PENDING_DEVICE_KEY, ACCOUNT_BINDING_RECEIPT_KEY]); }
  }
}
