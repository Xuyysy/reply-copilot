-- V1 referrals uses 0026 (0025 remains reserved for the pending Xiaodou SQL proposal).
-- Requires separately authorized D1 application; no auto-backfill of old users.
ALTER TABLE pending_registrations ADD COLUMN referral_code TEXT;
CREATE TABLE referral_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  code TEXT NOT NULL UNIQUE CHECK(length(code)=16),
  created_at INTEGER NOT NULL
);
CREATE TABLE referral_invites (
  invited_user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  inviter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  referral_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','rewarded')),
  reward_claim TEXT UNIQUE,
  registered_at INTEGER NOT NULL,
  rewarded_at INTEGER,
  CHECK(inviter_user_id<>invited_user_id),
  CHECK((status='pending' AND reward_claim IS NULL AND rewarded_at IS NULL)
     OR (status='rewarded' AND reward_claim IS NOT NULL AND rewarded_at IS NOT NULL))
);
CREATE INDEX referral_invites_inviter_idx ON referral_invites(inviter_user_id,status,registered_at DESC);
CREATE INDEX referral_invites_awarded_idx ON referral_invites(inviter_user_id,rewarded_at)
  WHERE status='rewarded';
-- Existing credit_batches and credit_ledger have CHECK enums and FK dependents:
-- preserve them; existing compatible 'admin_adjustment' enumeration is used
-- by the referral grant with unique 'referral:' IDs, independently identified
-- by this dedicated, append-only provenance table. No admin mutation is used.
CREATE TABLE referral_awards (
  invited_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  beneficiary_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  side TEXT NOT NULL CHECK(side IN ('inviter','invitee')),
  amount INTEGER NOT NULL CHECK(amount=50),
  credit_batch_id TEXT NOT NULL UNIQUE REFERENCES credit_batches(id) ON DELETE RESTRICT,
  ledger_reference_id TEXT NOT NULL UNIQUE,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY(invited_user_id,side)
);
CREATE INDEX referral_awards_beneficiary_idx ON referral_awards(beneficiary_user_id,granted_at DESC);
INSERT INTO system_settings(key,value,updated_at)
VALUES('referrals_enabled','0',0) ON CONFLICT(key) DO NOTHING;
