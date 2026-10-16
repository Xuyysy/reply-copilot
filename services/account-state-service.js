import { RUNTIME_CONFIG } from "../config/runtime.js";
import { AccountClient } from "./account-client.js";
import { createAccountState, EMPTY_ACCOUNT_STATE } from "../domain/account-state.js";

export class AccountStateService {
  constructor({ config = RUNTIME_CONFIG, client = new AccountClient({ config }) } = {}) { this.config = config; this.client = client; this.pending = null; this.cached = null; this.cachedAt = 0; }
  async getState({ force = false } = {}) {
    if (!force && this.cached && Date.now() - this.cachedAt < 30000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.loadState().then((state) => { this.cached = state; this.cachedAt = Date.now(); return state; }).finally(() => { this.pending = null; });
    return this.pending;
  }
  invalidate() { this.cached = null; this.cachedAt = 0; }
  updateServerQuota(quota) {
    if (this.cached?.source !== "server" || !Number.isInteger(quota?.totalRemaining)) return;
    this.cached = createAccountState({ ...this.cached, status: quota.totalRemaining <= 0 ? "credits_exhausted" : "credits_available", quota }, "server");
    this.cachedAt = Date.now();
  }
  async loadState() {
    if (!this.config.hostedApiUrl || !await this.client.token()) return EMPTY_ACCOUNT_STATE;
    try {
      const [account, entitlement, usage] = await Promise.all([this.client.fetchCurrentUser(), this.client.fetchEntitlement(), this.client.fetchUsage()]);
      return createAccountState({ status: entitlement.status, user: account.user, entitlement: entitlement.entitlement, trial: entitlement.trial, quota: usage.quota, license: entitlement.license }, "server");
    } catch (error) { return error?.code === "AUTH_REQUIRED" ? createAccountState({ status: "auth_expired" }, "server") : createAccountState({ status: "auth_unavailable" }, "server"); }
  }
}
