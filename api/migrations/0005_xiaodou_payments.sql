-- Add CNY payment state without rewriting or reinterpreting historical USD orders.
ALTER TABLE recharge_packages ADD COLUMN price_cny_fen INTEGER CHECK(price_cny_fen IS NULL OR price_cny_fen > 0);
UPDATE recharge_packages SET price_cents=149,price_cny_fen=990 WHERE id='starter';
UPDATE recharge_packages SET price_cents=299,price_cny_fen=1990 WHERE id='standard';
UPDATE recharge_packages SET price_cents=499,price_cny_fen=3290 WHERE id='large';
ALTER TABLE credit_accounts ADD COLUMN paid_reserved_for_refunds INTEGER NOT NULL DEFAULT 0 CHECK(paid_reserved_for_refunds >= 0 AND paid_reserved_for_refunds <= paid_balance);

-- Keep the append-only credit ledger while adding an explicit purchase reversal.
-- All existing rows are copied verbatim before the old table is replaced.
CREATE TABLE credit_ledger_v2 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('signup_grant','generation_debit','generation_refund','purchase_grant','purchase_reversal','admin_adjustment')),
  free_delta INTEGER NOT NULL DEFAULT 0,
  paid_delta INTEGER NOT NULL DEFAULT 0,
  reference_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id),
  reason TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(kind,reference_id)
);
INSERT INTO credit_ledger_v2(id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at)
SELECT id,user_id,kind,free_delta,paid_delta,reference_id,actor_user_id,reason,created_at FROM credit_ledger;
DROP TABLE credit_ledger;
ALTER TABLE credit_ledger_v2 RENAME TO credit_ledger;
CREATE INDEX credit_ledger_user_idx ON credit_ledger(user_id,created_at DESC);

CREATE TABLE payment_transactions (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES recharge_orders(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(provider IN ('xiaodou','local_mock')),
  currency TEXT NOT NULL CHECK(currency='CNY'),
  amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
  status TEXT NOT NULL CHECK(status IN ('pending','paid','failed','closed','unknown','refunded')),
  provider_trade_id TEXT UNIQUE,
  cashier_url TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  refunded_at INTEGER
);
CREATE INDEX payment_transactions_status_idx ON payment_transactions(provider,status,updated_at);

CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK(attempt_number > 0),
  provider_request_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('prepared','pending','failed','unknown')),
  cashier_url TEXT,
  provider_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(transaction_id,attempt_number)
);

CREATE TABLE payment_refunds (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  out_refund_no TEXT NOT NULL UNIQUE,
  provider_refund_id TEXT UNIQUE,
  amount_fen INTEGER NOT NULL CHECK(amount_fen > 0),
  status TEXT NOT NULL CHECK(status IN ('requested','pending','succeeded','failed','unknown')),
  reason TEXT NOT NULL,
  credits_reserved INTEGER NOT NULL DEFAULT 0 CHECK(credits_reserved >= 0),
  resolved_event_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  succeeded_at INTEGER
);
CREATE INDEX payment_refunds_transaction_idx ON payment_refunds(transaction_id,created_at);

-- Only verified platform events are inserted here. Raw webhook bodies and secrets are never stored.
CREATE TABLE provider_payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK(provider IN ('xiaodou','local_mock')),
  provider_event_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK(amount_fen >= 0),
  currency TEXT NOT NULL CHECK(currency='CNY'),
  body_sha256 TEXT,
  received_at INTEGER NOT NULL,
  UNIQUE(provider,provider_event_id)
);
