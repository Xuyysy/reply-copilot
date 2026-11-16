-- PRODUCTION INITIAL SCHEMA PROPOSAL (five networks): NOT AUTO-APPLIED.
-- Do not run against remote Production D1 until schema-only preflight, backup
-- bookmark, separate owner approval of the exact SQL and a rollback plan.
-- This is for databases where boltutil_orders and boltutil_payment_events
-- are absent. CREATE TABLE intentionally fails if those tables already exist.
-- Financial data must NEVER be deleted or overwritten.
-- This schema does not alter MK99/Xiaodou merchant switches, historical payments,
-- CNY transaction CHECK constraints or subscription payment transactions.
CREATE TABLE boltutil_orders (
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
CREATE INDEX boltutil_owner_recent_idx ON boltutil_orders(user_id,created_at DESC);
CREATE INDEX boltutil_pending_idx ON boltutil_orders(status,created_at) WHERE status IN ('creating','pending','unknown','manual_review');
CREATE UNIQUE INDEX boltutil_tx_unique ON boltutil_orders(network,tx_hash) WHERE tx_hash IS NOT NULL;
CREATE TABLE boltutil_payment_events (
  event_id TEXT PRIMARY KEY,
  external_order_id TEXT NOT NULL REFERENCES boltutil_orders(external_order_id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  network TEXT NOT NULL CHECK(network IN ('TRC20','POLYGON','BEP20','ERC20','SOLANA')),
  tx_hash TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX boltutil_payment_event_tx ON boltutil_payment_events(network,tx_hash);

-- Important: shared EVM 0x-style wallet addresses across Polygon/BEP20 do not
-- imply identical network or asset; uniqueness/evidence is per network+txHash.
