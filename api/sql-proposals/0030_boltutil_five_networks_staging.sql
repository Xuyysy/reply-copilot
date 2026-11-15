-- STAGING ONLY: PROPOSED SQL, not applied. Requires separate explicit owner
-- authorization for remote D1, preflight / snapshot and rollback runbook.
-- Preserve all existing orders/events and unique indexes. This rebuild is atomic.
-- Do not move into generic production migrations.
PRAGMA defer_foreign_keys=ON;

CREATE TABLE boltutil_orders_five_networks (
  id TEXT PRIMARY KEY,
  external_order_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE,
  product_type TEXT NOT NULL CHECK(product_type IN ('credits','subscription')),
  credit_order_id TEXT UNIQUE REFERENCES recharge_orders(id) ON DELETE RESTRICT,
  subscription_order_id TEXT UNIQUE REFERENCES subscription_orders(id) ON DELETE RESTRICT,
  network TEXT NOT NULL CHECK(network IN ('TRC20','POLYGON','BEP20','ERC20','SOLANA')),
  token_contract TEXT NOT NULL,
  token_decimals INTEGER NOT NULL CHECK(token_decimals IN (6,18)),
  base_amount_fen INTEGER NOT NULL CHECK(base_amount_fen>0),
  cny_per_usdt_micros INTEGER NOT NULL CHECK(cny_per_usdt_micros>0),
  quoted_usdt_micros INTEGER NOT NULL CHECK(quoted_usdt_micros>=1000000),
  payable_usdt_micros INTEGER CHECK(payable_usdt_micros>=1000000),
  paid_usdt_micros INTEGER CHECK(paid_usdt_micros>=0),
  payable_token_raw TEXT,
  receiving_address TEXT,
  tx_hash TEXT,
  checkout_url TEXT,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','unknown','paid','manual_review','closed')),
  paid_at INTEGER,
  applied_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK((product_type='credits' AND credit_order_id IS NOT NULL AND subscription_order_id IS NULL)
     OR (product_type='subscription' AND subscription_order_id IS NOT NULL AND credit_order_id IS NULL))
);
INSERT INTO boltutil_orders_five_networks SELECT * FROM boltutil_orders;

CREATE TABLE boltutil_payment_events_five_networks (
  event_id TEXT PRIMARY KEY,
  external_order_id TEXT NOT NULL REFERENCES boltutil_orders_five_networks(external_order_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('TRC20','POLYGON','BEP20','ERC20','SOLANA')),
  tx_hash TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
INSERT INTO boltutil_payment_events_five_networks SELECT * FROM boltutil_payment_events;

DROP TABLE boltutil_payment_events;
DROP TABLE boltutil_orders;
ALTER TABLE boltutil_orders_five_networks RENAME TO boltutil_orders;
ALTER TABLE boltutil_payment_events_five_networks RENAME TO boltutil_payment_events;

CREATE INDEX boltutil_owner_recent_idx ON boltutil_orders(user_id,created_at DESC);
CREATE INDEX boltutil_pending_idx ON boltutil_orders(status,created_at) WHERE status IN ('creating','pending','unknown','manual_review');
CREATE UNIQUE INDEX boltutil_tx_unique ON boltutil_orders(network,tx_hash) WHERE tx_hash IS NOT NULL;
CREATE UNIQUE INDEX boltutil_payment_event_tx ON boltutil_payment_events(network,tx_hash);
