-- Staging-only. Dedicated real-mainnet probe records; NO recharge/subscription/credit grants.
-- Apply only to reply-copilot-staging D1 after exact-source CI.
CREATE TABLE boltutil_admin_test_orders (
 id TEXT PRIMARY KEY,
 external_order_id TEXT NOT NULL UNIQUE,
 operation_id TEXT NOT NULL UNIQUE,
 admin_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 network TEXT NOT NULL CHECK(network IN ('TRC20','POLYGON','BEP20')),
 currency TEXT NOT NULL DEFAULT 'USDT' CHECK(currency='USDT'),
 requested_usdt_micros INTEGER NOT NULL CHECK(requested_usdt_micros=1000000),
 payable_usdt_micros INTEGER CHECK(payable_usdt_micros>=1000000 AND payable_usdt_micros<=1100000),
 payable_token_raw TEXT,
 token_contract TEXT NOT NULL,
 receiving_address TEXT,
 checkout_url TEXT,
 expires_at INTEGER,
 provider_status TEXT,
 status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','unknown','paid','manual_review','expired','failed')),
 tx_hash TEXT,
 paid_at INTEGER,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX boltutil_admin_test_network_tx ON boltutil_admin_test_orders(network,tx_hash) WHERE tx_hash IS NOT NULL;
CREATE INDEX boltutil_admin_test_recent ON boltutil_admin_test_orders(created_at DESC);
CREATE TABLE boltutil_admin_test_events (
 event_id TEXT PRIMARY KEY,
 external_order_id TEXT NOT NULL REFERENCES boltutil_admin_test_orders(external_order_id) ON DELETE RESTRICT,
 provider_status TEXT NOT NULL,
 network TEXT NOT NULL,
 tx_hash TEXT,
 created_at INTEGER NOT NULL
);
