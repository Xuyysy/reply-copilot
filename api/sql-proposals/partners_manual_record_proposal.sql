-- Source-only alternative for the reduced manual bookkeeping product.
-- Not an automatic migration. Requires independent scope/target approval.
-- Existing V1-A partner policy schema is a prerequisite. No payment binding,
-- recipient data, funds transfer, payout request or business row change.
CREATE TABLE partner_manual_records (
 id TEXT PRIMARY KEY,
 partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen BETWEEN 1 AND 1000000000000),
 transferred_at INTEGER NOT NULL CHECK(typeof(transferred_at)='integer' AND transferred_at>0),
 external_reference TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(external_reference) BETWEEN 4 AND 80),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 recorded_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=transferred_at),
 CHECK(recorded_by<>partner_user_id)
);
CREATE INDEX partner_manual_records_owner_idx ON partner_manual_records(partner_user_id,transferred_at DESC,id);
CREATE TRIGGER partner_manual_records_no_update BEFORE UPDATE ON partner_manual_records BEGIN SELECT RAISE(ABORT,'manual transfer record is immutable'); END;
CREATE TRIGGER partner_manual_records_no_delete BEFORE DELETE ON partner_manual_records BEGIN SELECT RAISE(ABORT,'manual transfer record is immutable'); END;
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_manual_reporting_enabled','0',0) ON CONFLICT(key) DO NOTHING;
