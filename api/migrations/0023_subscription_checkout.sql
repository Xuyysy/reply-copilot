-- Issue #21: source-only migration for an isolated one-shot MK99
-- subscription cashier. Do NOT execute against ANY remote D1, including
-- production, staging, or backups, without separate explicit permission.
-- No legacy paid_balance/credit_batches/recharge_orders changes.

ALTER TABLE subscription_payment_transactions
 ADD COLUMN checkout_state TEXT NOT NULL DEFAULT 'unprepared'
 CHECK(checkout_state IN ('unprepared','preparing','ready','unknown'));
ALTER TABLE subscription_payment_transactions
 ADD COLUMN checkout_attempted_at INTEGER;
ALTER TABLE subscription_payment_transactions
 ADD COLUMN cashier_url TEXT;
ALTER TABLE subscription_payment_transactions
 ADD COLUMN cashier_ready_at INTEGER;

-- Retain existing immutable order/transaction snapshots and provider payment
-- identity. A failed or uncertain create must NEVER be retried automatically:
-- query the fixed merchant-authenticated provider endpoint on the same order.
CREATE INDEX subscription_orders_user_pending_idx
 ON subscription_orders(user_id,status,created_at DESC)
 WHERE status IN ('pending','unknown');
