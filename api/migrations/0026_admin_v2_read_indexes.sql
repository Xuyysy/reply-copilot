-- Admin V2 read-performance indexes (source-only migration).
-- Do not execute on Staging/Production/backup D1 without distinct explicit
-- authorization, preflight, backup, migration review and rollback plan.
-- Additive indexes: no row updates, backfills, ledger writes or policy changes.
--
-- Global subscription order reporting has no usable leading created_at key:
-- existing user_created and pending-only indexes are insufficient for paid
-- orders across all users.
CREATE INDEX admin_subscription_orders_recent_idx
  ON subscription_orders(created_at DESC,id DESC);

-- Verified gross receipts must use transaction paid_at (not entitlement
-- applied_at); both products are queried independently over bounded windows.
CREATE INDEX admin_credit_receipts_paid_idx
  ON payment_transactions(paid_at DESC,order_id)
  WHERE paid_at IS NOT NULL
    AND status IN ('paid','refunded')
    AND merchant_provider IN ('mk99','xiaodou');

CREATE INDEX admin_subscription_receipts_paid_idx
  ON subscription_payment_transactions(paid_at DESC,order_id)
  WHERE paid_at IS NOT NULL
    AND status IN ('paid','refunded')
    AND merchant_provider IN ('mk99','xiaodou');

-- The existing ai_requests_status_idx is user_id-leading; it cannot efficiently
-- serve an all-user 24h failed/uncertain-requests count.
CREATE INDEX admin_failed_ai_recent_idx
  ON ai_requests(status,created_at DESC)
  WHERE status IN ('upstream_failed','uncertain');
