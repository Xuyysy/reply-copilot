-- Source-only, requires V1-A/B/D. Not an automatic migration.
-- Alipay-only receiving details; never store plaintext or payment passwords.
INSERT INTO system_settings(key,value,updated_at)
VALUES('partner_alipay_recipient_enabled','0',0) ON CONFLICT(key) DO NOTHING;
CREATE TABLE partner_alipay_recipients (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=1),
 key_id TEXT NOT NULL CHECK(length(key_id) BETWEEN 1 AND 40),
 nonce_hex TEXT NOT NULL CHECK(length(nonce_hex)=24),
 ciphertext_hex TEXT NOT NULL CHECK(length(ciphertext_hex) BETWEEN 32 AND 4096),
 account_mask TEXT NOT NULL CHECK(length(account_mask) BETWEEN 1 AND 40),
 name_mask TEXT NOT NULL CHECK(length(name_mask) BETWEEN 1 AND 12),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 PRIMARY KEY(user_id,version)
);
CREATE TRIGGER partner_alipay_recipient_no_update BEFORE UPDATE ON partner_alipay_recipients
BEGIN SELECT RAISE(ABORT,'recipient version immutable'); END;
-- Retention/deletion policy must be approved before collecting real data.
CREATE TABLE partner_alipay_payout_destinations (
 payout_id TEXT PRIMARY KEY REFERENCES partner_payouts(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL,
 recipient_version INTEGER NOT NULL,
 FOREIGN KEY(user_id,recipient_version) REFERENCES partner_alipay_recipients(user_id,version) ON DELETE RESTRICT
);
CREATE TRIGGER partner_alipay_destination_guard BEFORE INSERT ON partner_alipay_payout_destinations
BEGIN SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partner_payouts p
 WHERE p.id=NEW.payout_id AND p.partner_user_id=NEW.user_id AND p.status='reserved')
 OR NOT EXISTS(SELECT 1 FROM partner_alipay_recipients r WHERE r.user_id=NEW.user_id AND r.version=NEW.recipient_version)
 THEN RAISE(ABORT,'recipient ownership mismatch') END; END;
CREATE TRIGGER partner_alipay_destination_no_update BEFORE UPDATE ON partner_alipay_payout_destinations
BEGIN SELECT RAISE(ABORT,'payout destination immutable'); END;
CREATE TRIGGER partner_alipay_destination_no_delete BEFORE DELETE ON partner_alipay_payout_destinations
BEGIN SELECT RAISE(ABORT,'payout destination immutable'); END;
-- A snapshot must be selected within the same atomic transaction that reserves
-- the payout. Actual transfer workflow is a separate, not yet enabled stage.
