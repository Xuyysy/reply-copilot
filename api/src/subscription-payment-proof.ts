import type {Env} from './types';
import {boltReadSchemaReady} from './boltutil/environment';

/**
 * Existing subscription's authenticated payment proof for cross-rail upgrades.
 * The SQL caller MUST have `subscription_orders source` joined to the
 * active target period by source_order_id and user_id. The original payment
 * must remain verified at BOTH invoice creation and settlement.
 *
 * Do not synthesize a CNY transaction for USDT subscriptions. Crypto tables
 * may not be referenced before an explicitly ready Staging/Production schema.
 * This helper is SQL-only: it performs no reads or writes by itself.
 */
export function verifiedSubscriptionSourceSql(env:Env):string {
 const merchant=env.ENVIRONMENT==='production'
  ?"AND t.merchant_provider IN ('mk99','xiaodou')"
  :"AND t.merchant_provider IN ('mk99','xiaodou','local_mock')";
 const fiat=`EXISTS(SELECT 1 FROM subscription_payment_transactions t
   WHERE t.order_id=source.id AND t.status='paid' AND t.paid_at IS NOT NULL
     AND t.risk_state='clear' AND t.currency='CNY'
     AND t.amount_fen=source.amount_fen ${merchant}
     AND EXISTS(SELECT 1 FROM subscription_payment_events e
       WHERE e.transaction_id=t.id AND e.merchant_provider=t.merchant_provider
         AND e.event_type='PAYMENT_SUCCEEDED' AND e.amount_fen=t.amount_fen
         AND (t.merchant_provider='local_mock' OR e.body_sha256 IS NOT NULL)))`;
 const crypto=boltReadSchemaReady(env)?` OR EXISTS(SELECT 1 FROM boltutil_orders b
   WHERE b.subscription_order_id=source.id AND b.user_id=source.user_id
     AND b.product_type='subscription' AND b.status='paid'
     AND b.paid_at IS NOT NULL AND b.applied_at IS NOT NULL
     AND b.tx_hash IS NOT NULL AND b.receiving_address IS NOT NULL
     AND b.payable_usdt_micros>=1000000
     AND b.paid_usdt_micros>=b.payable_usdt_micros
     AND EXISTS(SELECT 1 FROM boltutil_payment_events e
       WHERE e.external_order_id=b.external_order_id AND e.network=b.network
         AND e.tx_hash=b.tx_hash AND e.body_sha256 IS NOT NULL))`:'';
 return "(source.status='paid' AND source.paid_at IS NOT NULL AND source.applied_at IS NOT NULL AND ("+fiat+crypto+"))";
}
