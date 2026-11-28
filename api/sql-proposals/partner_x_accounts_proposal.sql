-- Source-only proposal. Requires partner applications and policy schema.
-- Manual overrides are append-only; approved application remains immutable.
CREATE TABLE partner_x_account_versions (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version INTEGER NOT NULL CHECK(version>=1),
 x_handle TEXT NOT NULL CHECK(length(x_handle) BETWEEN 1 AND 15 AND x_handle NOT GLOB '*[^a-z0-9_]*'),
 updated_at INTEGER NOT NULL CHECK(updated_at>0),
 updated_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 operation_id TEXT NOT NULL UNIQUE,
 PRIMARY KEY(user_id,version)
);
CREATE TRIGGER partner_x_account_immutable BEFORE UPDATE ON partner_x_account_versions
 BEGIN SELECT RAISE(ABORT,'partner X account history is immutable'); END;
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_x_accounts_enabled','0',0) ON CONFLICT(key) DO NOTHING;
