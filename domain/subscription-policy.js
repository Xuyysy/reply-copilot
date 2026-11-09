// Subscription billing policy V1. Pure functions only: no payment, D1 or clock I/O.
// Issue #21: the subscription quota is separate from permanent paid/free credits.
// All amounts are final buyer prices in CNY fen. Server payment snapshots must be
// immutable even if an administrator later changes the displayed plan price.

export const SUBSCRIPTION_DAY_MS = 24 * 60 * 60 * 1000;
export const SUBSCRIPTION_PERIOD_DAYS = 30;
export const SUBSCRIPTION_PERIOD_MS = SUBSCRIPTION_DAY_MS * SUBSCRIPTION_PERIOD_DAYS;

export const SUBSCRIPTION_PLANS_V1 = Object.freeze({
  basic: Object.freeze({ code: 'basic', priceFen: 6990, dailyLimit: 500, days: 30 }),
  pro: Object.freeze({ code: 'pro', priceFen: 11990, dailyLimit: 1000, days: 30 }),
  max: Object.freeze({ code: 'max', priceFen: 17990, dailyLimit: 1500, days: 30 }),
  ultra: Object.freeze({ code: 'ultra', priceFen: 25990, dailyLimit: 2000, days: 30 })
});

const PLAN_ORDER = Object.freeze(['basic', 'pro', 'max', 'ultra']);

function nonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${field} must be a non-negative safe integer`);
  return value;
}

export function subscriptionPlan(code) {
  if (typeof code !== 'string' || !Object.hasOwn(SUBSCRIPTION_PLANS_V1, code))
    throw new RangeError('Unknown subscription plan');
  return SUBSCRIPTION_PLANS_V1[code];
}

/**
 * A paid 30x24h period contains exactly 30 anchored day buckets, never 31.
 * Time uses server-trusted UTC epoch milliseconds, not the browser's timezone.
 */
export function subscriptionDayWindow(startAt, now) {
  nonNegativeInteger(startAt, 'startAt');
  nonNegativeInteger(now, 'now');
  const expiresAt = startAt + SUBSCRIPTION_PERIOD_MS;
  if (!Number.isSafeInteger(expiresAt)) throw new RangeError('Period timestamp overflow');
  if (now < startAt) return { status: 'queued', dayIndex: null, resetAt: startAt, expiresAt };
  if (now >= expiresAt) return { status: 'expired', dayIndex: null, resetAt: null, expiresAt };
  const dayIndex = Math.floor((now - startAt) / SUBSCRIPTION_DAY_MS);
  const nextDayAt = startAt + (dayIndex + 1) * SUBSCRIPTION_DAY_MS;
  return { status: 'active', dayIndex, resetAt: Math.min(nextDayAt, expiresAt), expiresAt };
}

/** Used+reserved must not exceed the current tier limit, including after upgrades. */
export function subscriptionDailyAvailability(dailyLimit, used, reserved = 0) {
  nonNegativeInteger(dailyLimit, 'dailyLimit');
  nonNegativeInteger(used, 'used');
  nonNegativeInteger(reserved, 'reserved');
  if (dailyLimit < 1 || used + reserved > dailyLimit)
    throw new RangeError('Subscription daily quota invariant violated');
  return Object.freeze({ dailyLimit, usedToday: used, reservedToday: reserved, remainingToday: dailyLimit - used - reserved });
}

/**
 * The funding source is selected at reservation time and is immutable for the
 * request through delivery ACK, replay or release. This function never mutates
 * a credit balance. With an active subscription, free welcome credits cannot
 * be used as a subscription-overage source.
 */
export function chooseGenerationSource({ subscriptionActive, subscriptionRemaining = 0, paidRemaining = 0, freeRemaining = 0 }) {
  if (typeof subscriptionActive !== 'boolean') throw new TypeError('subscriptionActive must be boolean');
  for (const [name, value] of Object.entries({ subscriptionRemaining, paidRemaining, freeRemaining }))
    nonNegativeInteger(value, name);
  if (subscriptionActive) {
    if (subscriptionRemaining > 0) return 'subscription';
    return paidRemaining > 0 ? 'paid' : 'none';
  }
  if (freeRemaining > 0) return 'free';
  return paidRemaining > 0 ? 'paid' : 'none';
}

/**
 * Quote an immediate in-period upgrade, preserving start/end and today's usage.
 * Quotes are informational; a trusted short-lived order snapshot must be
 * revalidated and successfully paid before an entitlement is ever changed.
 * Price overrides are intended ONLY for server-verified immutable order/plan
 * snapshots, never for client-provided values.
 */
export function quoteSubscriptionUpgrade({
  currentPlan, targetPlan, periodStartAt, expiresAt, now,
  currentPriceFen, targetPriceFen
}) {
  const oldPlan = subscriptionPlan(currentPlan);
  const newPlan = subscriptionPlan(targetPlan);
  if (PLAN_ORDER.indexOf(targetPlan) <= PLAN_ORDER.indexOf(currentPlan))
    throw new RangeError('Only an upgrade to a higher tier is supported');
  for (const [name, value] of Object.entries({ periodStartAt, expiresAt, now }))
    nonNegativeInteger(value, name);
  if (expiresAt !== periodStartAt + SUBSCRIPTION_PERIOD_MS || now < periodStartAt || now >= expiresAt)
    throw new RangeError('Subscription period is not active or has an invalid duration');
  const remainingMs = expiresAt - now;
  if (remainingMs < SUBSCRIPTION_DAY_MS)
    throw new RangeError('Upgrade is not available in the final 24 hours');
  const fromFen = currentPriceFen ?? oldPlan.priceFen;
  const toFen = targetPriceFen ?? newPlan.priceFen;
  nonNegativeInteger(fromFen, 'currentPriceFen');
  nonNegativeInteger(toFen, 'targetPriceFen');
  if (fromFen < 1 || toFen <= fromFen) throw new RangeError('Invalid upgrade price snapshots');
  const differenceFen = BigInt(toFen - fromFen);
  const amount = (differenceFen * BigInt(remainingMs) + BigInt(SUBSCRIPTION_PERIOD_MS) - 1n) / BigInt(SUBSCRIPTION_PERIOD_MS);
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('Upgrade amount overflow');
  return Object.freeze({
    currentPlan, targetPlan, amountFen: Number(amount), remainingMs,
    newDailyLimit: newPlan.dailyLimit, expiresAt, resetsExistingUsage: false
  });
}
