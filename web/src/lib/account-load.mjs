// Account page read resilience: distinguish transient transport failures from
// authentication, and keep optional activity from blanking the whole dashboard.
// Only GET requests belong here. Never retry purchases or payments.
const RETRYABLE_CODES = new Set(["API_TIMEOUT", "API_NETWORK_ERROR", "INVALID_RESPONSE", "SERVER_UNAVAILABLE", "HTTP_ERROR"]);

export function isTransientAccountReadError(error) {
  if (!error || typeof error !== "object") return false;
  if (error.code === "API_CANCELLED") return false;
  if (typeof error.status === "number") {
    if (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500) return true;
    return false;
  }
  return RETRYABLE_CODES.has(error.code) || error instanceof TypeError;
}

export async function retryAccountRead(read, {sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), delays = [220, 650]} = {}) {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      if (attempt >= delays.length || !isTransientAccountReadError(error)) throw error;
      await sleep(delays[attempt]);
    }
  }
}

export async function loadAccountSnapshot(request, options = {}) {
  // The authenticated identity and quota are required; activity/ledger/orders
  // are secondary. A brief outage there must not masquerade as a failed login.
  const accountPromise = retryAccountRead(() => request("/v1/me"), options);
  const usagePromise = retryAccountRead(() => request("/v1/usage"), options);
  const activityPromise = request("/v1/activity").catch(() => null);
  const [account, usage, activity] = await Promise.all([accountPromise, usagePromise, activityPromise]);
  return {account, usage, activity};
}
