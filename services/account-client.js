import { RUNTIME_CONFIG } from "../config/runtime.js";

export const ACCOUNT_TOKEN_KEY = "replyCopilotAccountToken";
export const ACCOUNT_DEVICE_ID_KEY = "replyCopilotDeviceId";
export const ACCOUNT_PENDING_DEVICE_KEY = "replyCopilotPendingDevice";

function allowedOrigin(raw, config) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || (config.channel === "development" && url.protocol === "http:" && config.allowedHttpHosts?.includes(url.hostname));
  } catch { return false; }
}

export class AccountClient {
  constructor({ config = RUNTIME_CONFIG, storage = globalThis.chrome?.storage?.local, fetchImpl = fetch, openTab = (url) => chrome.tabs.create({ url }) } = {}) { this.config = config; this.storage = storage; this.fetchImpl = fetchImpl; this.openTab = openTab; }
  websiteUrl(path) {
    if (!this.config.websiteUrl || !allowedOrigin(this.config.websiteUrl, this.config)) return null;
    try { const url = new URL(path, this.config.websiteUrl); return url.origin === new URL(this.config.websiteUrl).origin ? url.href : null; }
    catch { return null; }
  }
  async openWebsite(path) { const url = this.websiteUrl(path); if (!url) throw new Error("官网尚未配置，请稍后再试。"); await this.openTab(url); }
  openLoginPage(mode = "login") { return this.openWebsite(mode === "register" ? "/login?mode=register" : "/login"); }
  openAccountPage() { return this.openWebsite("/account"); }
  openPurchasePage() { return this.openWebsite("/pricing"); }
  async token() { return (await this.storage.get(ACCOUNT_TOKEN_KEY))[ACCOUNT_TOKEN_KEY] || ""; }
  async request(path, { method = "GET", body, signal, authenticate = true } = {}) {
    if (!this.config.hostedApiUrl || !allowedOrigin(this.config.hostedApiUrl, this.config)) throw new Error("云端 AI 服务尚未配置。");
    const token = authenticate ? await this.token() : "";
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
  fetchCurrentUser() { return this.request("/v1/me"); }
  fetchEntitlement() { return this.request("/v1/entitlements"); }
  fetchUsage() { return this.request("/v1/usage"); }
  refreshEntitlement() { return this.fetchEntitlement(); }
  async beginDeviceAuthorization({ mode = "login" } = {}) {
    if (await this.token()) throw new Error("账户已连接。如需切换账号，请先在设置中心退出当前账户。");
    const pending = (await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY];
    if (pending?.deviceToken && pending?.deviceCode && Date.parse(pending.expiresAt || "") > Date.now()) {
      await this.openWebsite(`/account?device_code=${pending.deviceCode}`);
      return pending.deviceCode;
    }
    const saved = await this.storage.get(ACCOUNT_DEVICE_ID_KEY);
    const deviceId = saved[ACCOUNT_DEVICE_ID_KEY] || crypto.randomUUID();
    await this.storage.set({ [ACCOUNT_DEVICE_ID_KEY]: deviceId });
    const data = await this.request("/v1/extension/device-code", { method: "POST", authenticate: false, body: { deviceId } });
    if (!/^[A-F0-9]{8}$/.test(data?.deviceCode || "") || !/^[a-f0-9]{64}$/.test(data?.deviceToken || "")) throw new Error("绑定请求返回内容无效。");
    await this.storage.set({ [ACCOUNT_PENDING_DEVICE_KEY]: { deviceToken: data.deviceToken, deviceCode: data.deviceCode, expiresAt: data.expiresAt } });
    await this.openWebsite(`/account?device_code=${data.deviceCode}`);
    return data.deviceCode;
  }
  async pollDeviceAuthorization() {
    const pending = (await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY];
    if (!pending?.deviceToken) return false;
    if (Date.parse(pending.expiresAt || "") < Date.now()) { await this.storage.remove(ACCOUNT_PENDING_DEVICE_KEY); throw new Error("绑定码已过期，请重新登录。"); }
    const data = await this.request("/v1/extension/exchange", { method: "POST", authenticate: false, body: { deviceToken: pending.deviceToken } });
    if (data?.status === "pending") return false;
    if (data?.status !== "approved" || !/^[a-f0-9]{64}$/.test(data?.accessToken || "")) throw new Error("绑定结果无效。");
    await this.storage.set({ [ACCOUNT_TOKEN_KEY]: data.accessToken });
    await this.storage.remove(ACCOUNT_PENDING_DEVICE_KEY);
    return true;
  }
  async hasPendingDeviceAuthorization() { return Boolean((await this.storage.get(ACCOUNT_PENDING_DEVICE_KEY))[ACCOUNT_PENDING_DEVICE_KEY]?.deviceToken); }
  async logout() {
    try { if (await this.token()) await this.request("/v1/auth/logout", { method: "POST", body: {} }); }
    finally { await this.storage.remove([ACCOUNT_TOKEN_KEY, ACCOUNT_PENDING_DEVICE_KEY]); }
  }
}
