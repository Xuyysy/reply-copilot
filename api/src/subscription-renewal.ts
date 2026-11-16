import type { Env } from './types';
import { ApiFailure } from './types';
import { nowMs } from './security';
import { SUBSCRIPTION_PERIOD_MS } from '../../domain/subscription-policy.js';
import {boltReadSchemaReady} from './boltutil/environment';

type QueuedPeriod={id:string;user_id:string};
const MAX_CANDIDATES=20;

/**
 * Lazy + scheduled activation for a PAID queued 30-day renewal.
 *
 * The user receives exactly 30 full 24-hour buckets starting when the queue
 * activates, so cron delay never short-changes purchased duration. The old
 * period's quota does not roll into this one. SQL evaluates proofs and the
 * no-other-active guard in ONE atomic batch, preventing double activation.
 */
export async function activateQueuedSubscriptionForUser(env:Env,userId:string,now=nowMs()):Promise<boolean>{
 if(env.SUBSCRIPTIONS_ENABLED!=='1')return false;
 if(!Number.isSafeInteger(now)||now<0)throw new ApiFailure(503,'SUBSCRIPTION_CLOCK_INVALID','订阅时间状态异常。');
 const q=await env.DB.prepare(`SELECT q.id,q.user_id FROM subscription_periods q
   WHERE q.user_id=? AND q.status='queued' AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=q.source_order_id AND o.status='paid')
   ORDER BY q.created_at ASC,q.id ASC LIMIT 1`).bind(userId).first<QueuedPeriod>();
 if(!q)return false;
 // Preserve full duration. Never use the client's time for a quota bucket.
 const endAt=now+SUBSCRIPTION_PERIOD_MS;
 const cryptoProof=boltReadSchemaReady(env) ? ` OR EXISTS (
   SELECT 1 FROM subscription_orders o
   JOIN subscription_plan_versions v ON v.id=o.plan_version_id
   JOIN boltutil_orders b ON b.subscription_order_id=o.id AND b.user_id=o.user_id
   WHERE o.id=subscription_periods.source_order_id AND o.user_id=subscription_periods.user_id
     AND o.kind IN ('purchase','renewal') AND o.status='paid'
     AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL
     AND v.id=subscription_periods.plan_version_id
     AND v.daily_limit=subscription_periods.daily_limit
     AND b.product_type='subscription' AND b.status='paid'
     AND b.paid_at IS NOT NULL AND b.applied_at IS NOT NULL
     AND b.base_amount_fen=o.amount_fen
     AND b.payable_usdt_micros>=1000000
     AND b.paid_usdt_micros>=b.payable_usdt_micros
     AND b.tx_hash IS NOT NULL AND b.receiving_address IS NOT NULL
     AND EXISTS(SELECT 1 FROM boltutil_payment_events e
       WHERE e.external_order_id=b.external_order_id AND e.network=b.network
         AND e.tx_hash=b.tx_hash AND e.body_sha256 IS NOT NULL)
 )` : '';
 const statements=[
   env.DB.prepare(`UPDATE subscription_periods SET status='expired',updated_at=?
      WHERE user_id=? AND status='active' AND end_at<=?`).bind(now,userId,now),
   env.DB.prepare(`UPDATE subscription_periods SET status='active',
      start_at=?,end_at=?,updated_at=?
      WHERE id=? AND user_id=? AND status='queued' AND start_at IS NULL AND end_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM subscription_periods a WHERE a.user_id=? AND a.status IN ('active','refund_pending','revoked') AND a.end_at>?)
        AND NOT EXISTS (SELECT 1 FROM subscription_periods older
          WHERE older.user_id=? AND older.status='queued' AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=older.source_order_id AND o.status='paid')
            AND (older.created_at<subscription_periods.created_at
              OR (older.created_at=subscription_periods.created_at AND older.id<subscription_periods.id)))
        AND EXISTS (SELECT 1 FROM users u WHERE u.id=? AND u.status='active' AND u.archived_at IS NULL)
        AND (EXISTS (SELECT 1 FROM subscription_orders o
          JOIN subscription_payment_transactions t ON t.order_id=o.id
          JOIN subscription_plan_versions v ON v.id=o.plan_version_id
          WHERE o.id=subscription_periods.source_order_id AND o.user_id=subscription_periods.user_id
            AND o.kind IN ('purchase','renewal') AND o.status='paid'
            AND o.paid_at IS NOT NULL AND o.applied_at IS NOT NULL
            AND t.status='paid' AND t.paid_at IS NOT NULL AND t.risk_state='clear'
            AND t.amount_fen=o.amount_fen AND t.currency='CNY'
            AND v.daily_limit=subscription_periods.daily_limit
            AND v.id=subscription_periods.plan_version_id
            AND (?<>'production' OR t.merchant_provider IN ('mk99','xiaodou'))
            AND EXISTS (SELECT 1 FROM subscription_payment_events e
              WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
              AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
              AND (t.merchant_provider='local_mock' OR e.body_sha256 IS NOT NULL)))${cryptoProof})`)
     .bind(now,endAt,now,q.id,userId,userId,now,userId,userId,env.ENVIRONMENT)
 ];
 try{
   const result=await env.DB.batch(statements);
   return Number(result[1]?.meta?.changes??0)===1;
 }catch{
   throw new ApiFailure(503,'SUBSCRIPTION_RENEWAL_UNCONFIRMED','订阅续购状态暂不可用，请重试。');
 }
}

/** Bounded cron handoff; idempotent per user and safe when feature is off. */
export async function activateDueQueuedSubscriptions(env:Env,now=nowMs()):Promise<number>{
 if(env.SUBSCRIPTIONS_ENABLED!=='1')return 0;
 const rows=await env.DB.prepare(`SELECT DISTINCT q.user_id FROM subscription_periods q
    WHERE q.status='queued' AND EXISTS(SELECT 1 FROM subscription_orders o WHERE o.id=q.source_order_id AND o.status='paid')
      AND NOT EXISTS(SELECT 1 FROM subscription_periods p
         WHERE p.user_id=q.user_id AND p.status IN ('active','refund_pending','revoked') AND p.end_at>?)
    LIMIT ?`).bind(now,MAX_CANDIDATES).all<{user_id:string}>();
 let activated=0;
 for(const row of rows.results??[]){
   if(await activateQueuedSubscriptionForUser(env,row.user_id,now))activated++;
 }
 return activated;
}
