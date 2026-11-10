-- 0025: Extend the isolated subscription ledger to authenticated Xiaodou RSA2.
-- Source-only until separately approved on remote D1. Do not alter applied
-- migration 0022 or 0023. Keep every historical MK99 order/event byte.
--
-- Cloudflare D1 enforces foreign keys; event rows referencing the transaction
-- table are copied before rebuilding the CHECK constraint. PRAGMA foreign_keys
-- = off is not supported by D1. Defer only during this migration.
PRAGMA defer_foreign_keys = on;

CREATE TABLE _subscription_events_backup_0025 AS
 SELECT id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at
 FROM subscription_payment_events;
DROP TABLE subscription_payment_events;

CREATE TABLE subscription_payment_transactions_0025 (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES subscription_orders(id) ON DELETE RESTRICT,
  merchant_provider TEXT NOT NULL CHECK(merchant_provider IN ('mk99','local_mock','xiaodou')),
  merchant_account TEXT,
  provider_trade_id TEXT NOT NULL UNIQUE,
  provider_payment_id TEXT,
  payment_channel TEXT NOT NULL CHECK(payment_channel IN ('ALIPAY_H5','WECHAT_H5','LOCAL_MOCK')),
  amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
  currency TEXT NOT NULL DEFAULT 'CNY' CHECK(currency='CNY'),
  notification_sign_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN
    ('pending','unknown','paid','failed','closed','refunded')),
  risk_state TEXT NOT NULL DEFAULT 'clear' CHECK(risk_state IN ('clear','manual_review','frozen')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER,
  checkout_state TEXT NOT NULL DEFAULT 'unprepared'
    CHECK(checkout_state IN ('unprepared','preparing','ready','unknown')),
  checkout_attempted_at INTEGER,
  cashier_url TEXT,
  cashier_ready_at INTEGER,
  CHECK(merchant_provider<>'mk99' OR (merchant_account IS NOT NULL AND notification_sign_type IS NOT NULL)),
  CHECK(merchant_provider<>'xiaodou' OR (merchant_account IS NOT NULL AND notification_sign_type IS NOT NULL))
);

INSERT INTO subscription_payment_transactions_0025
 (id,order_id,merchant_provider,merchant_account,provider_trade_id,provider_payment_id,
  payment_channel,amount_fen,currency,notification_sign_type,status,risk_state,
  created_at,updated_at,paid_at,checkout_state,checkout_attempted_at,cashier_url,cashier_ready_at)
SELECT id,order_id,merchant_provider,merchant_account,provider_trade_id,provider_payment_id,
  payment_channel,amount_fen,currency,notification_sign_type,status,risk_state,
  created_at,updated_at,paid_at,checkout_state,checkout_attempted_at,cashier_url,cashier_ready_at
FROM subscription_payment_transactions;

DROP TABLE subscription_payment_transactions;
ALTER TABLE subscription_payment_transactions_0025 RENAME TO subscription_payment_transactions;
CREATE UNIQUE INDEX subscription_payment_merchant_trade_uq
  ON subscription_payment_transactions(merchant_provider,provider_payment_id)
  WHERE provider_payment_id IS NOT NULL;

CREATE TABLE subscription_payment_events (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES subscription_payment_transactions(id) ON DELETE RESTRICT,
  merchant_provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  amount_fen INTEGER NOT NULL CHECK(amount_fen>=0),
  body_sha256 TEXT,
  received_at INTEGER NOT NULL,
  UNIQUE(merchant_provider,provider_event_id)
);
INSERT INTO subscription_payment_events
 (id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at)
SELECT id,transaction_id,merchant_provider,provider_event_id,event_type,amount_fen,body_sha256,received_at
FROM _subscription_events_backup_0025;
CREATE INDEX subscription_payment_events_transaction_idx
 ON subscription_payment_events(transaction_id,received_at DESC);
DROP TABLE _subscription_events_backup_0025;
PRAGMA foreign_key_check;
PRAGMA defer_foreign_keys = off;
