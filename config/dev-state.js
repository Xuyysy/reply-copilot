export const DEV_MOCK_STATE_KEY = "replyCopilotDevMockState";
export const DEV_MOCK_STATUSES = Object.freeze(["developer_mode", "guest", "trial_active", "trial_exhausted", "trial_expired", "lifetime_active", "auth_unavailable"]);
export async function readDevMock(storage) {
  const value = (await storage.get(DEV_MOCK_STATE_KEY))[DEV_MOCK_STATE_KEY];
  return DEV_MOCK_STATUSES.includes(value) ? value : "developer_mode";
}
export async function writeDevMock(storage, status) {
  if (!DEV_MOCK_STATUSES.includes(status)) throw new Error("未知的开发测试状态。");
  await storage.set({ [DEV_MOCK_STATE_KEY]: status });
}
