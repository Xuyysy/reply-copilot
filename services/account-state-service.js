import { RUNTIME_CONFIG } from "../config/runtime.js";
import { AccountClient } from "./account-client.js";
import { createAccountState, EMPTY_ACCOUNT_STATE } from "../domain/account-state.js";

export class AccountStateService {
  constructor({ config = RUNTIME_CONFIG, client = new AccountClient({ config }) } = {}) { this.config = config; this.client = client; this.pending = null; this.cached = null; this.cachedAt = 0; this.cachedToken = null; }
  async getState({ force = false } = {}) {
    if (!force && this.cached && Date.now() - this.cachedAt < 30000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = this.loadState().then((state) => { this.cached = state; this.cachedAt = Date.now(); return state; }).finally(() => { this.pending = null; });
    return this.pending;
  }
  invalidate() { this.cached = null; this.cachedAt = 0; this.cachedToken = null; }
  async getOwnerId() {
    const token=await this.client.token();
    if(!token)return null;
    if(this.cachedToken===token&&this.cached&&Date.now()-this.cachedAt<30000)return this.cached.user?.userId||null;
    const state=await this.getState({force:true});
    return this.cachedToken===token ? state.user?.userId||null : null;
  }
  peekState() { return this.cached; }
  updateServerSubscription(subscription, ownerId) {
    const cached = this.cached;
    if (!ownerId || cached?.source !== "server" || cached.user?.userId !== ownerId || cached.status === "frozen") return;
    if (subscription.status !== "active" || !cached.quota) { this.invalidate(); return; }
    const next = createAccountState({ ...cached, subscription,
      status: subscription.remainingToday > 0 || cached.quota.paidRemaining > 0 ? "credits_available" : "credits_exhausted"
    }, "server");
    if (!next.subscription) { this.invalidate(); return; }
    // Keep the original account TTL so a delivery never extends cached auth.
    this.cached = next;
  }
  updateServerQuota(quota) {
    if (this.cached?.source !== "server" || !Number.isInteger(quota?.totalRemaining)) return;
    // Legacy generate replies carry only permanent-credit balances. If a daily
    // subscription is active, do not overwrite the verified entitlement status
    // with an exhausted-credit status; reread the server-owned subscription.
    if (this.cached.subscription?.status === "active") { this.invalidate(); return; }
    this.cached = createAccountState({ ...this.cached, status: quota.totalRemaining <= 0 ? "credits_exhausted" : "credits_available", quota }, "server");
    this.cachedAt = Date.now();
  }
  async loadState() {
    const token=await this.client.token();
    if (!this.config.hostedApiUrl || !token) return EMPTY_ACCOUNT_STATE;
    try {
      const [account, entitlement, usage] = await Promise.all([this.client.fetchCurrentUser(), this.client.fetchEntitlement(), this.client.fetchUsage()]);
      if(await this.client.token()!==token){this.cachedToken=null;return createAccountState({status:'auth_unavailable'},'server');}
      this.cachedToken=token;
      return createAccountState({ status: entitlement.status, user: account.user, features: entitlement.features ? {...entitlement.features,verifiedAt:Date.now()} : null, entitlement: entitlement.entitlement, trial: entitlement.trial, quota: usage.quota, subscription: usage.subscription, license: entitlement.license }, "server");
    } catch (error) { return error?.code === "AUTH_REQUIRED" ? createAccountState({ status: "auth_expired" }, "server") : createAccountState({ status: "auth_unavailable" }, "server"); }
  }
}
