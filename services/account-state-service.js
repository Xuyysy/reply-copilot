import { RUNTIME_CONFIG } from "../config/runtime.js";
import { AccountClient } from "./account-client.js";
import { createAccountState, EMPTY_ACCOUNT_STATE } from "../domain/account-state.js";
import { readDevMock } from "../config/dev-state.js";

export class AccountStateService {
  constructor({ config = RUNTIME_CONFIG, client = new AccountClient({ config }), storage = globalThis.chrome?.storage?.local } = {}) { this.config = config; this.client = client; this.storage = storage; this.pending = null; this.cached = null; this.cachedAt = 0; if (config.channel === "development") globalThis.chrome?.storage?.onChanged?.addListener?.((changes, area) => { if (area === "local" && "replyCopilotDevMockState" in changes) this.invalidate(); }); }
  async getState({ force = false } = {}) {
    if (!force && this.cached && Date.now() - this.cachedAt < 30000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.loadState().then((state) => { this.cached = state; this.cachedAt = Date.now(); return state; }).finally(() => { this.pending = null; });
    return this.pending;
  }
  invalidate() { this.cached = null; this.cachedAt = 0; }
  updateServerQuota(quota) {
    if (this.cached?.source !== "server" || !Number.isInteger(quota?.dailyRemaining)) return;
    this.cached = createAccountState({ ...this.cached, status: quota.dailyRemaining <= 0 && this.cached.status === "trial_active" ? "trial_exhausted" : this.cached.status, quota }, "server");
    this.cachedAt = Date.now();
  }
  async loadState() {
    if (this.config.channel === "development" && (!this.config.hostedApiUrl || !await this.client.token())) {
      const status = await readDevMock(this.storage);
      return createAccountState({ status, user: null, quota: null, trial: null, license: null }, "development_mock");
    }
    if (!this.config.hostedApiUrl || !await this.client.token()) return EMPTY_ACCOUNT_STATE;
    try {
      const [account, entitlement, usage] = await Promise.all([this.client.fetchCurrentUser(), this.client.fetchEntitlement(), this.client.fetchUsage()]);
      return createAccountState({ status: entitlement.status === "trial_active" && usage.quota?.dailyRemaining <= 0 ? "trial_exhausted" : entitlement.status, user: account.user, entitlement: entitlement.entitlement, trial: entitlement.trial, quota: usage.quota, license: entitlement.license }, "server");
    } catch (error) { return error?.code === "AUTH_REQUIRED" ? EMPTY_ACCOUNT_STATE : createAccountState({ status: "auth_unavailable" }, "server"); }
  }
}
