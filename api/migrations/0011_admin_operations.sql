-- Additive operations metadata; no financial balance or historical order rewrites.
CREATE TABLE site_administrator (
 id INTEGER PRIMARY KEY CHECK(id=1),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 bound_at INTEGER NOT NULL
);
INSERT INTO site_administrator(id,user_id,bound_at)
 SELECT 1,id,CAST(strftime('%s','now') AS INTEGER)*1000 FROM users WHERE role='admin'
 AND (SELECT count(*) FROM users WHERE role='admin')=1;
CREATE UNIQUE INDEX users_single_admin ON users(role) WHERE role='admin';
CREATE TABLE admin_operations (
 id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL REFERENCES users(id),
 action TEXT NOT NULL,target_id TEXT NOT NULL,fingerprint TEXT NOT NULL,created_at INTEGER NOT NULL
);
CREATE TABLE admin_reauth_sessions (
 session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
ALTER TABLE users ADD COLUMN is_test_account INTEGER NOT NULL DEFAULT 0 CHECK(is_test_account IN (0,1));
ALTER TABLE users ADD COLUMN archived_at INTEGER;
ALTER TABLE recharge_packages ADD COLUMN description_zh TEXT NOT NULL DEFAULT '';
ALTER TABLE recharge_packages ADD COLUMN description_en TEXT NOT NULL DEFAULT '';
ALTER TABLE recharge_packages ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'fixed_cny' CHECK(settlement_mode IN ('fixed_cny','usd_exchange'));
ALTER TABLE recharge_packages ADD COLUMN exchange_rate_micros INTEGER;
ALTER TABLE recharge_packages ADD COLUMN fee_rate_bps INTEGER NOT NULL DEFAULT 150 CHECK(fee_rate_bps BETWEEN 0 AND 3000);
ALTER TABLE payment_transactions ADD COLUMN settlement_mode TEXT NOT NULL DEFAULT 'fixed_cny';
ALTER TABLE payment_transactions ADD COLUMN exchange_rate_micros INTEGER;
INSERT INTO system_settings(key,value,updated_at) VALUES('site_content','{}',CAST(strftime('%s','now') AS INTEGER)*1000);
