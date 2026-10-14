import { RUNTIME_CONFIG } from "../config/runtime.js";

export const ACCOUNT_TOKEN_KEY = "replyCopilotAccountToken";
export class AccountClient {
  constructor({ config = RUNTIME_CONFIG, storage = globalThis.chrome?.storage?.local, fetchImpl = fetch, openTab = (url) => chrome.tabs.create({ url }) } = {}) { this.config = config; this.storage = storage; this.fetchImpl = fetchImpl; this.openTab = openTab; }
  websiteUrl(path) {
    if (!this.config.websiteUrl) return null;
    try { const url = new URL(path, this.config.websiteUrl); return url.protocol === "https:" && url.origin === new URL(this.config.websiteUrl).origin ? url.href : null; }
    catch { return null; }
  }
  async openWebsite(path) { const url = this.websiteUrl(path); if (!url) throw new Error("官网尚未开放，请稍后再试。"); await this.openTab(url); }
  openLoginPage() { return this.openWebsite("/login"); }
  openAccountPage() { return this.openWebsite("/account"); }
  openPurchasePage() { return this.openWebsite("/purchase"); }
  async token() { return (await this.storage.get(ACCOUNT_TOKEN_KEY))[ACCOUNT_TOKEN_KEY] || ""; }
  async request(path, { method = "GET", body, signal } = {}) {
    if (!this.config.hostedApiUrl) throw new Error("云端 AI 服务尚未配置。");
    const token = await this.token(); if (!token) throw new Error("请先登录。");
    const url = new URL(path, this.config.hostedApiUrl);
    if (url.protocol !== "https:" || url.origin !== new URL(this.config.hostedApiUrl).origin) throw new Error("云端服务地址无效。");
    let response;
    try { response = await Reflect.apply(this.fetchImpl, globalThis, [url.href, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(body?.requestId ? { "Idempotency-Key": body.requestId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), ...(signal ? { signal } : {}) }]); }
    catch (error) { if (signal?.aborted || error?.name === "AbortError") throw Object.assign(new Error("云端请求已超时或取消。"), { code: "NETWORK_ERROR" }); throw Object.assign(new Error("授权服务暂时无法连接，请稍后重试。"), { code: "NETWORK_ERROR" }); }
    let data; try { data = await response.json(); } catch { throw new Error("云端服务返回内容无效。"); }
    if (!response.ok) throw Object.assign(new Error(data?.message || "云端服务暂时不可用。"), { code: data?.code || "SERVER_UNAVAILABLE", status: response.status });
    return data;
  }
  fetchCurrentUser() { return this.request("/v1/me"); }
  fetchEntitlement() { return this.request("/v1/entitlements"); }
  fetchUsage() { return this.request("/v1/usage"); }
  refreshEntitlement() { return this.fetchEntitlement(); }
  async logout() { await this.storage.remove(ACCOUNT_TOKEN_KEY); }
}
