import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBSCRIPTION_DAY_MS, SUBSCRIPTION_PERIOD_DAYS, SUBSCRIPTION_PERIOD_MS,
  SUBSCRIPTION_PLANS_V1, subscriptionPlan, subscriptionDayWindow,
  subscriptionDailyAvailability, chooseGenerationSource, quoteSubscriptionUpgrade
} from '../../domain/subscription-policy.js';

const start = Date.UTC(2026, 10, 9, 14, 30, 0);
const expiresAt = start + SUBSCRIPTION_PERIOD_MS;

test('Issue #21: all four buyer-price and daily-quota plan snapshots are exact', () => {
  assert.deepEqual(Object.values(SUBSCRIPTION_PLANS_V1).map(p => [p.code, p.priceFen, p.dailyLimit, p.days]), [
    ['basic', 6990, 500, 30], ['pro', 11990, 1000, 30],
    ['max', 17990, 1500, 30], ['ultra', 25990, 2000, 30]
  ]);
  assert.equal(SUBSCRIPTION_PERIOD_DAYS, 30);
  assert.throws(() => subscriptionPlan('__proto__'), /Unknown/);
  assert.throws(() => subscriptionPlan('enterprise'), /Unknown/);
  assert.equal(Object.isFrozen(subscriptionPlan('pro')), true);
});

test('subscription has precisely thirty anchored 24-hour buckets, not 31 calendar-day grants', () => {
  assert.deepEqual(subscriptionDayWindow(start, start - 1), {
    status: 'queued', dayIndex: null, resetAt: start, expiresAt
  });
  assert.deepEqual(subscriptionDayWindow(start, start), {
    status: 'active', dayIndex: 0, resetAt: start + SUBSCRIPTION_DAY_MS, expiresAt
  });
  assert.equal(subscriptionDayWindow(start, start + SUBSCRIPTION_DAY_MS - 1).dayIndex, 0);
  assert.equal(subscriptionDayWindow(start, start + SUBSCRIPTION_DAY_MS).dayIndex, 1);
  assert.equal(subscriptionDayWindow(start, expiresAt - 1).dayIndex, 29);
  assert.equal(subscriptionDayWindow(start, expiresAt - 1).resetAt, expiresAt);
  assert.deepEqual(subscriptionDayWindow(start, expiresAt), {
    status: 'expired', dayIndex: null, resetAt: null, expiresAt
  });
  assert.equal(subscriptionDayWindow(start, expiresAt + SUBSCRIPTION_DAY_MS).status, 'expired');
});

test('midnight and browser timezone never determine subscription daily reset', () => {
  const before = start + 10 * 60 * 60 * 1000;
  assert.equal(new Date(before).getUTCDate(), 10);
  assert.equal(subscriptionDayWindow(start, before).dayIndex, 0);
  assert.equal(subscriptionDayWindow(start, before).resetAt, start + SUBSCRIPTION_DAY_MS);
});

test('daily availability subtracts consumed and in-flight reservations', () => {
  assert.deepEqual(subscriptionDailyAvailability(1000, 480, 10), {
    dailyLimit: 1000, usedToday: 480, reservedToday: 10, remainingToday: 510
  });
  assert.equal(subscriptionDailyAvailability(500, 490, 10).remainingToday, 0);
  assert.equal(subscriptionDailyAvailability(2000, 1999).remainingToday, 1);
  for (const [limit, used] of [[500, 501], [1000, 1001], [1500, 1501], [2000, 2001]]) {
    assert.throws(() => subscriptionDailyAvailability(limit, used, 0), /invariant/);
  }
  assert.throws(() => subscriptionDailyAvailability(500, 490, 11), /invariant/);
  assert.throws(() => subscriptionDailyAvailability(500, -1, 0), /non-negative/);
});

test('live subscription prioritizes daily bucket then separately paid permanent credits', () => {
  assert.equal(chooseGenerationSource({ subscriptionActive: true, subscriptionRemaining: 1, paidRemaining: 10, freeRemaining: 200 }), 'subscription');
  assert.equal(chooseGenerationSource({ subscriptionActive: true, subscriptionRemaining: 0, paidRemaining: 10, freeRemaining: 200 }), 'paid');
  assert.equal(chooseGenerationSource({ subscriptionActive: true, subscriptionRemaining: 0, paidRemaining: 0, freeRemaining: 200 }), 'none');
});

test('without a subscription existing free-then-paid priority remains unchanged', () => {
  assert.equal(chooseGenerationSource({ subscriptionActive: false, freeRemaining: 200, paidRemaining: 400 }), 'free');
  assert.equal(chooseGenerationSource({ subscriptionActive: false, freeRemaining: 0, paidRemaining: 400 }), 'paid');
  assert.equal(chooseGenerationSource({ subscriptionActive: false, freeRemaining: 0, paidRemaining: 0 }), 'none');
  assert.throws(() => chooseGenerationSource({ subscriptionActive: 'true' }), /boolean/);
  assert.throws(() => chooseGenerationSource({ subscriptionActive: true, paidRemaining: -1 }), /non-negative/);
});

test('Basic to Pro upgrade halfway through charges 25 CNY and does not extend or reset', () => {
  const q = quoteSubscriptionUpgrade({
    currentPlan: 'basic', targetPlan: 'pro',
    periodStartAt: start, expiresAt, now: start + 15 * SUBSCRIPTION_DAY_MS
  });
  assert.deepEqual(q, {
    currentPlan: 'basic', targetPlan: 'pro', amountFen: 2500,
    remainingMs: 15 * SUBSCRIPTION_DAY_MS, newDailyLimit: 1000,
    expiresAt, resetsExistingUsage: false
  });
  assert.equal(subscriptionDailyAvailability(q.newDailyLimit, 480, 10).remainingToday, 510);
});

test('ascending multi-step upgrades calculate the remaining tier price difference', () => {
  const halfway = start + 15 * SUBSCRIPTION_DAY_MS;
  const basicToPro = quoteSubscriptionUpgrade({ currentPlan: 'basic', targetPlan: 'pro', periodStartAt: start, expiresAt, now: halfway });
  const proToMax = quoteSubscriptionUpgrade({ currentPlan: 'pro', targetPlan: 'max', periodStartAt: start, expiresAt, now: halfway });
  const basicToMax = quoteSubscriptionUpgrade({ currentPlan: 'basic', targetPlan: 'max', periodStartAt: start, expiresAt, now: halfway });
  assert.equal(basicToPro.amountFen + proToMax.amountFen, basicToMax.amountFen);
  assert.equal(basicToMax.amountFen, 5500);
  assert.equal(quoteSubscriptionUpgrade({ currentPlan: 'max', targetPlan: 'ultra', periodStartAt: start, expiresAt, now: halfway }).amountFen, 4000);
});

test('strict server-time integer rounding never undercharges by a fraction of a fen', () => {
  const q = quoteSubscriptionUpgrade({
    currentPlan: 'basic', targetPlan: 'pro', periodStartAt: start,
    expiresAt, now: start + 11 * SUBSCRIPTION_DAY_MS + 1
  });
  assert.equal(q.amountFen, Math.ceil((11990 - 6990) * (19 * SUBSCRIPTION_DAY_MS - 1) / SUBSCRIPTION_PERIOD_MS));
  assert.equal(q.amountFen, 3167);
});

test('no same-tier, downgrade, expired, queued or last-day upgrade', () => {
  const base = { periodStartAt: start, expiresAt, now: start + 15 * SUBSCRIPTION_DAY_MS };
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPlan: 'pro', targetPlan: 'pro' }), /higher tier/);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPlan: 'pro', targetPlan: 'basic' }), /higher tier/);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPlan: 'basic', targetPlan: 'pro', now: expiresAt }), /not active/);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPlan: 'basic', targetPlan: 'pro', now: start - 1 }), /not active/);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPlan: 'basic', targetPlan: 'pro', now: expiresAt - SUBSCRIPTION_DAY_MS + 1 }), /final 24 hours/);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPlan: 'basic', targetPlan: 'pro', expiresAt: expiresAt + 1 }), /invalid duration/);
});

test('override prices must be verified, monotonic server snapshots', () => {
  const base = { currentPlan: 'pro', targetPlan: 'max', periodStartAt: start, expiresAt, now: start + 15 * SUBSCRIPTION_DAY_MS };
  assert.equal(quoteSubscriptionUpgrade({ ...base, currentPriceFen: 11990, targetPriceFen: 17990 }).amountFen, 3000);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPriceFen: 500, targetPriceFen: 500 }), /Invalid upgrade/);
  assert.throws(() => quoteSubscriptionUpgrade({ ...base, currentPriceFen: -1, targetPriceFen: 17990 }), /non-negative/);
});
