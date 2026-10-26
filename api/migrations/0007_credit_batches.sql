-- Keep aggregate account balances as compatibility mirrors while tracking each
-- grant and each request's exact consumption source.
ALTER TABLE credit_accounts ADD COLUMN free_generation_reserved INTEGER NOT NULL DEFAULT 0 CHECK(free_generation_reserved >= 0 AND free_generation_reserved <= free_balance);
ALTER TABLE credit_accounts ADD COLUMN paid_generation_reserved INTEGER NOT NULL DEFAULT 0 CHECK(paid_generation_reserved >= 0 AND paid_generation_reserved <= paid_balance);
ALTER TABLE ai_requests ADD COLUMN generation_phase TEXT NOT NULL DEFAULT 'generating' CHECK(generation_phase IN ('generating','awaiting_delivery','unknown'));
ALTER TABLE ai_requests ADD COLUMN delivery_confirmed_at INTEGER;
ALTER TABLE ai_requests ADD COLUMN delivery_confirmation_id TEXT;

-- A deliberately small assertion table lets a D1 batch force transaction
-- rollback if a gated multi-row transition did not complete all invariants.
CREATE TABLE credit_operation_assertions(
  operation_id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK(ok=1)
);

CREATE TABLE credit_ledger_v3 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('signup_grant','generation_debit','generation_refund','generation_release','purchase_grant','purchase_reversal','admin_adjustment')),
  free_delta INTEGER NOT NULL DEFAULT 0,
  paid_delta INTEGER NOT NULL DEFAULT 0,
  reference_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(kind,reference_id)
);
INSERT INTO credit_ledger_v3(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at)
SELECT id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at FROM credit_ledger;
DROP TABLE credit_ledger;
ALTER TABLE credit_ledger_v3 RENAME TO credit_ledger;
CREATE INDEX credit_ledger_user_idx ON credit_ledger(user_id,created_at DESC);

CREATE TABLE credit_batches (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  bucket TEXT NOT NULL CHECK(bucket IN ('free','paid')),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('signup','legacy_free','legacy_paid','purchase','admin_adjustment')),
  source_order_id TEXT REFERENCES recharge_orders(id) ON DELETE RESTRICT,
  grant_credits INTEGER NOT NULL CHECK(grant_credits >= 0),
  remaining_credits INTEGER NOT NULL CHECK(remaining_credits >= 0),
  consumed_credits INTEGER NOT NULL DEFAULT 0 CHECK(consumed_credits >= 0),
  permanently_revoked_credits INTEGER NOT NULL DEFAULT 0 CHECK(permanently_revoked_credits >= 0),
  generation_reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK(generation_reserved_credits >= 0),
  refund_reserved_credits INTEGER NOT NULL DEFAULT 0 CHECK(refund_reserved_credits >= 0),
  granted_at INTEGER NOT NULL,
  paid_at INTEGER,
  history_confidence TEXT NOT NULL CHECK(history_confidence IN ('tracked','legacy_unknown')),
  status TEXT NOT NULL CHECK(status IN ('active','refund_pending','refunded','manual_review')),
  manual_review_reason TEXT,
  CHECK(generation_reserved_credits + refund_reserved_credits <= remaining_credits),
  CHECK(history_confidence='legacy_unknown' OR grant_credits=remaining_credits+consumed_credits+permanently_revoked_credits),
  CHECK((source_kind='purchase' AND bucket='paid' AND source_order_id IS NOT NULL) OR source_kind<>'purchase')
);
CREATE UNIQUE INDEX credit_batches_purchase_order_uq ON credit_batches(source_order_id) WHERE source_order_id IS NOT NULL;
CREATE INDEX credit_batches_user_bucket_idx ON credit_batches(user_id,bucket,status,paid_at,granted_at,id);

CREATE TABLE ai_credit_allocations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  credit_batch_id TEXT NOT NULL REFERENCES credit_batches(id) ON DELETE RESTRICT,
  credits INTEGER NOT NULL DEFAULT 1 CHECK(credits=1),
  state TEXT NOT NULL CHECK(state IN ('reserved','consumed','released')),
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  released_at INTEGER,
  UNIQUE(user_id,request_id),
  FOREIGN KEY(user_id,request_id) REFERENCES ai_requests(user_id,request_id) ON DELETE RESTRICT
);
CREATE INDEX ai_credit_allocations_batch_state_idx ON ai_credit_allocations(credit_batch_id,state,created_at);
ALTER TABLE payment_refunds ADD COLUMN credit_batch_id TEXT REFERENCES credit_batches(id) ON DELETE RESTRICT;

-- Existing balances are seeded exactly as they stand today. Their historical
-- grant/use attribution is unknowable, therefore legacy batches are never
-- automatically refundable. Any aggregate refund reservation stays reserved.
INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status,manual_review_reason)
SELECT 'legacy-free:'||user_id,user_id,'free','legacy_free',free_balance,free_balance,0,0,0,0,created_at,'legacy_unknown','active','历史免费额度无法按批次确认使用归属'
FROM credit_accounts WHERE free_balance>0;
INSERT INTO credit_batches(id,user_id,bucket,source_kind,grant_credits,remaining_credits,consumed_credits,permanently_revoked_credits,generation_reserved_credits,refund_reserved_credits,granted_at,history_confidence,status,manual_review_reason)
SELECT 'legacy-paid:'||user_id,user_id,'paid','legacy_paid',paid_balance,paid_balance,0,0,0,paid_reserved_for_refunds,created_at,'legacy_unknown','active','历史付费额度无法映射到具体订单或确认是否使用'
FROM credit_accounts WHERE paid_balance>0;

-- Existing pending refund reservations belong to the aggregate legacy paid
-- lot. Link them so their eventual verified event can release/revoke the same
-- reserved balance after migration.
UPDATE payment_refunds
SET credit_batch_id=(
  SELECT b.id FROM payment_transactions t
  JOIN recharge_orders o ON o.id=t.order_id
  JOIN credit_batches b ON b.user_id=o.user_id AND b.source_kind='legacy_paid'
  WHERE t.id=payment_refunds.transaction_id
)
WHERE status IN ('requested','pending','unknown') AND credits_reserved>0;

-- Fail migration rather than silently accept any historical aggregate mismatch.
CREATE TABLE credit_batch_migration_assert (
  ok INTEGER NOT NULL CHECK(ok=1)
);
INSERT INTO credit_batch_migration_assert(ok)
SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM credit_accounts a
  WHERE a.free_balance<>COALESCE((SELECT SUM(b.remaining_credits) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='free'),0)
     OR a.paid_balance<>COALESCE((SELECT SUM(b.remaining_credits) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid'),0)
     OR a.paid_reserved_for_refunds<>COALESCE((SELECT SUM(b.refund_reserved_credits) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid'),0)
) THEN 1 ELSE 0 END;
DROP TABLE credit_batch_migration_assert;
