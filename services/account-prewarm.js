/**
 * Bounded, read-only account preparation for a focused X tab.
 * Actual eligibility, owner binding, quota reservation and ACK remain
 * authoritative on the existing generation path.
 */
export function createAccountPrewarmer({
  readAccount,
  readPreferences,
  now = () => Date.now(),
  cooldownMs = 30_000,
}) {
  if (typeof readAccount !== "function" || typeof readPreferences !== "function")
    throw new TypeError("Account prewarm requires read-only readers");
  let lastAttemptAt = null;
  let inFlight = null;
  const prime = () => {
    if (inFlight) return inFlight; // One read shared by every X tab.
    const startedAt = now();
    if (lastAttemptAt !== null && startedAt - lastAttemptAt < cooldownMs)
      return Promise.resolve({kind:"cooldown",elapsedMs:0});
    lastAttemptAt = startedAt;
    inFlight = Promise.allSettled([
      Promise.resolve().then(readAccount),
      Promise.resolve().then(readPreferences),
    ]).then(results => ({
      kind: results.every(item => item.status === "fulfilled") ? "prepared" : "failed",
      elapsedMs: Math.max(0,Math.round(now() - startedAt)),
    })).finally(() => { inFlight = null; });
    return inFlight;
  };
  return {prime,reset() { lastAttemptAt = null; }};
}
