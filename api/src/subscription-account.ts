import type { Env } from './types';
import { ApiFailure } from './types';
import { subscriptionDayWindow, subscriptionDailyAvailability } from '../../domain/subscription-policy.js';
import { activateQueuedSubscriptionForUser } from './subscription-renewal';

// Deliberately OFF in all deployed environments until the entire subscription
// payment + reservation + ACK + refunds pipeline is ready and migrated.
export function subscriptionsEnabled(env: Env): boolean {
  return env.SUBSCRIPTIONS_ENABLED === '1';
}

export type SubscriptionAccount = {
  status: 'none' | 'active';
  plan: 'basic' | 'pro' | 'max' | 'ultra' | null;
  dailyLimit: number;
  usedToday: number;
  reservedToday: number;
  remainingToday: number;
  resetAt: string | null;
  startAt: string | null;
  expiresAt: string | null;
};

const NONE: Readonly<SubscriptionAccount> = Object.freeze({
  status: 'none', plan: null, dailyLimit: 0, usedToday: 0,
  reservedToday: 0, remainingToday: 0, resetAt: null,
  startAt: null, expiresAt: null
});

type ActivePeriod = {
  id: string;
  plan_code: string;
  daily_limit: number;
  start_at: number;
  end_at: number;
};

/**
 * Server-trusted, read-only subscription balance for both browser and extension.
 * Subscriptions must never be confused with credit_accounts/free/paid balances.
 * A paid status without a reconciled provider event must not authorize access.
 */
export async function subscriptionAccount(env: Env, userId: string, now: number = Date.now()): Promise<SubscriptionAccount> {
  if (!subscriptionsEnabled(env)) return { ...NONE };
  if (!Number.isSafeInteger(now) || now < 0) throw new ApiFailure(503, 'SUBSCRIPTION_CLOCK_INVALID', '订阅时间暂时不可用。');

  const activeQuery = () => env.DB.prepare(`SELECT p.id,p.daily_limit,p.start_at,p.end_at,v.plan_code
    FROM subscription_periods p
    JOIN subscription_plan_versions v ON v.id=p.plan_version_id
    JOIN subscription_orders o ON o.id=p.source_order_id AND o.user_id=p.user_id
    JOIN subscription_payment_transactions t ON t.order_id=o.id
    JOIN users u ON u.id=p.user_id
    WHERE p.user_id=? AND p.status='active'
      AND p.start_at<=? AND p.end_at>?
      AND u.status='active' AND u.archived_at IS NULL
      AND o.status='paid' AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL
      AND t.status='paid' AND t.paid_at IS NOT NULL AND t.risk_state='clear'
      AND t.currency='CNY' AND t.amount_fen=o.amount_fen AND t.merchant_provider IN ('mk99','xiaodou','local_mock')
      AND (?<>'production' OR t.merchant_provider IN ('mk99','xiaodou'))
      AND EXISTS (
        SELECT 1 FROM subscription_payment_events e
        WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
          AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
          AND (t.merchant_provider='local_mock' OR e.body_sha256 IS NOT NULL)
      )
    LIMIT 1`).bind(userId,now,now,env.ENVIRONMENT).first<ActivePeriod>();

  // The BoltUtil proof is a separate money domain. Never query its tables
  // before an independently approved Staging migration has been applied.
  const cryptoReady=env.ENVIRONMENT==='staging'&&env.BOLTUTIL_SCHEMA_READY==='1';
  const cryptoQuery=()=>env.DB.prepare(
    "SELECT p.id,p.daily_limit,p.start_at,p.end_at,v.plan_code FROM subscription_periods p "+
    "JOIN subscription_plan_versions v ON v.id=p.plan_version_id "+
    "JOIN subscription_orders o ON o.id=p.source_order_id AND o.user_id=p.user_id "+
    "JOIN boltutil_orders b ON b.subscription_order_id=o.id AND b.user_id=p.user_id "+
    "JOIN users u ON u.id=p.user_id "+
    "WHERE p.user_id=? AND p.status='active' AND p.start_at<=? AND p.end_at>? "+
    "AND u.status='active' AND u.archived_at IS NULL "+
    "AND o.status='paid' AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL "+
    "AND b.status='paid' AND b.paid_at IS NOT NULL AND b.applied_at IS NOT NULL "+
    "AND b.product_type='subscription' AND b.tx_hash IS NOT NULL AND b.receiving_address IS NOT NULL "+
    "AND b.payable_usdt_micros>=1000000 AND b.paid_usdt_micros>=b.payable_usdt_micros "+
    "AND EXISTS(SELECT 1 FROM boltutil_payment_events e WHERE e.external_order_id=b.external_order_id "+
    "AND e.network=b.network AND e.tx_hash=b.tx_hash AND e.body_sha256 IS NOT NULL) LIMIT 1")
      .bind(userId,now,now).first<ActivePeriod>();
  let row = await activeQuery();
  if(!row&&cryptoReady)row=await cryptoQuery();
  if (!row) {
    // A verified queued renewal becomes usable on the first request after expiry.
    if (await activateQueuedSubscriptionForUser(env,userId,now)){
      row=await activeQuery();
      if(!row&&cryptoReady)row=await cryptoQuery();
    }
  }
  if (!row) return { ...NONE };

  const window = subscriptionDayWindow(row.start_at, now);
  if (window.status !== 'active' || window.expiresAt !== row.end_at || window.dayIndex === null)
    throw new ApiFailure(503, 'SUBSCRIPTION_PERIOD_INVALID', '订阅有效期校验失败，请联系支持。');

  const usage = await env.DB.prepare(
    'SELECT used,reserved FROM subscription_daily_usage WHERE period_id=? AND day_index=?'
  ).bind(row.id,window.dayIndex).first<{used:number;reserved:number}>();
  let quota: ReturnType<typeof subscriptionDailyAvailability>;
  try {
    quota = subscriptionDailyAvailability(row.daily_limit,usage?.used??0,usage?.reserved??0);
  } catch {
    throw new ApiFailure(503, 'SUBSCRIPTION_USAGE_INVALID', '订阅额度状态暂不可用，请联系支持。');
  }
  if (!['basic','pro','max','ultra'].includes(row.plan_code))
    throw new ApiFailure(503, 'SUBSCRIPTION_PLAN_INVALID', '订阅套餐状态异常。');

  return {
    status: 'active',
    plan: row.plan_code as SubscriptionAccount['plan'],
    dailyLimit: quota.dailyLimit,
    usedToday: quota.usedToday,
    reservedToday: quota.reservedToday,
    remainingToday: quota.remainingToday,
    resetAt: new Date(window.resetAt!).toISOString(),
    startAt: new Date(row.start_at).toISOString(),
    expiresAt: new Date(row.end_at).toISOString()
  };
}

/** Available generations are subscription allowance, then free, then paid credits. */
export function availableNow(quota: { freeRemaining: number; paidRemaining: number }, subscription: SubscriptionAccount): number {
  if (subscription.status === 'active') return subscription.remainingToday + quota.freeRemaining + quota.paidRemaining;
  return quota.freeRemaining + quota.paidRemaining;
}
