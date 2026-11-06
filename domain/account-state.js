export const ACCOUNT_STATUSES = Object.freeze(["guest", "auth_expired", "credits_available", "credits_exhausted", "frozen", "trial_active", "trial_exhausted", "trial_expired", "lifetime_active", "auth_unavailable", "developer_mode"]);
export const EMPTY_ACCOUNT_STATE = Object.freeze({ status: "guest", user: null, entitlement: null, trial: null, quota: null, license: null, lastVerifiedAt: null, source: "none" });

export function createAccountState(value, source = "server") {
  if (!value || !ACCOUNT_STATUSES.includes(value.status)) throw new Error("授权状态无效。");
  if (source === "server" && value.status === "developer_mode") throw new Error("服务端不能返回开发模式。");
  const quota = value.quota && Number.isInteger(value.quota.totalRemaining) ? {
    freeRemaining: value.quota.freeRemaining,
    paidRemaining: value.quota.paidRemaining,
    totalRemaining: value.quota.totalRemaining,
  } : value.quota && Number.isInteger(value.quota.dailyLimit) && Number.isInteger(value.quota.dailyRemaining) ? {
    dailyLimit: value.quota.dailyLimit,
    dailyUsed: value.quota.dailyUsed,
    dailyRemaining: value.quota.dailyRemaining,
    resetAt: value.quota.resetAt || null,
  } : null;
  return Object.freeze({ ...(value.features ? {features:value.features} : {}), status: value.status, user: value.user || null, entitlement: value.entitlement || null, trial: value.trial || null, quota, license: value.license || null, lastVerifiedAt: source === "server" ? new Date().toISOString() : null, source });
}

export function accountStatusLabel(state) {
  switch (state?.status) {
    case "credits_available": return `剩余 ${state.quota?.totalRemaining ?? "—"} 次`;
    case "credits_exhausted": return "生成次数已用完";
    case "frozen": return "账户已暂停";
    case "trial_active": return state.source === "server" ? `今日剩余 ${state.quota?.dailyRemaining ?? "—"} 次` : "开发测试：模拟试用中";
    case "trial_exhausted": return state.source === "server" ? "今日额度已用完" : "开发测试：模拟额度耗尽";
    case "trial_expired": return state.source === "server" ? "体验已结束" : "开发测试：模拟体验结束";
    case "lifetime_active": return state.source === "server" ? "终身版" : "开发测试：模拟终身授权";
    case "developer_mode": return "本地开发测试 · 自带 API Key";
    case "auth_unavailable": return "授权状态暂时无法确认";
    case "auth_expired": return "登录已过期，请重新连接";
    default: return "尚未登录";
  }
}
