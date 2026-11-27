-- Source-only proposal. No remote D1 application without explicit approval.
-- Requires 0033/0034. No plaintext recipient fields, automatic payment, or balance changes.
CREATE TABLE partner_payout_profiles (
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=1),
 ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 40 AND 2048),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(user_id,version)
);
CREATE TABLE partner_request_recipients (
 request_id TEXT PRIMARY KEY REFERENCES partner_manual_requests(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL,
 profile_version INTEGER NOT NULL,
 FOREIGN KEY(user_id,profile_version) REFERENCES partner_payout_profiles(user_id,version) ON DELETE RESTRICT
);
CREATE TABLE partner_payout_reveal_audit (
 id TEXT PRIMARY KEY,
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 user_id TEXT NOT NULL,
 profile_version INTEGER NOT NULL,
 request_id TEXT REFERENCES partner_manual_requests(id) ON DELETE RESTRICT,
 created_at INTEGER NOT NULL,
 FOREIGN KEY(user_id,profile_version) REFERENCES partner_payout_profiles(user_id,version) ON DELETE RESTRICT
);
CREATE INDEX partner_payout_reveal_owner_idx ON partner_payout_reveal_audit(user_id,created_at DESC);
CREATE TRIGGER partner_payout_profile_no_update BEFORE UPDATE ON partner_payout_profiles BEGIN SELECT RAISE(ABORT,'payout profile version immutable'); END;
CREATE TRIGGER partner_payout_profile_no_delete BEFORE DELETE ON partner_payout_profiles BEGIN SELECT RAISE(ABORT,'payout profile version immutable'); END;
CREATE TRIGGER partner_payout_profile_pending_lock BEFORE INSERT ON partner_payout_profiles
 WHEN EXISTS(SELECT 1 FROM partner_manual_requests WHERE partner_user_id=NEW.user_id AND status='pending')
 BEGIN SELECT RAISE(ABORT,'pending settlement locks recipient'); END;
CREATE TRIGGER partner_payout_profile_required BEFORE INSERT ON partner_manual_requests
 WHEN EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_profile_enabled' AND value='1')
 AND NOT EXISTS(SELECT 1 FROM partner_payout_profiles WHERE user_id=NEW.partner_user_id)
 BEGIN SELECT RAISE(ABORT,'payout profile required'); END;
CREATE TRIGGER partner_payout_recipient_snapshot AFTER INSERT ON partner_manual_requests
 WHEN EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_profile_enabled' AND value='1')
 BEGIN INSERT INTO partner_request_recipients(request_id,user_id,profile_version)
 SELECT NEW.id,NEW.partner_user_id,MAX(version) FROM partner_payout_profiles WHERE user_id=NEW.partner_user_id; END;
CREATE TRIGGER partner_payout_snapshot_no_update BEFORE UPDATE ON partner_request_recipients BEGIN SELECT RAISE(ABORT,'payout snapshot immutable'); END;
CREATE TRIGGER partner_payout_snapshot_no_delete BEFORE DELETE ON partner_request_recipients BEGIN SELECT RAISE(ABORT,'payout snapshot immutable'); END;
CREATE TRIGGER partner_payout_legacy_completion_guard BEFORE UPDATE ON partner_manual_requests
 WHEN NEW.status='completed' AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_profile_enabled' AND value='1')
 AND NOT EXISTS(SELECT 1 FROM partner_request_recipients WHERE request_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'settlement has no verified recipient snapshot'); END;
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_payout_profile_enabled','0',0) ON CONFLICT(key) DO NOTHING;
