-- New registrations receive a pending welcome-credit entitlement. Only the
-- first successful extension exchange on an unclaimed installation grants it.
-- Existing accounts/credit lots remain unchanged (no retroactive debit).
-- Never store a new raw device ID here: the Worker derives an HMAC digest.

CREATE TABLE signup_benefit_claims (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE RESTRICT,
  grant_amount INTEGER NOT NULL CHECK(grant_amount BETWEEN 1 AND 1000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','granted')),
  device_digest TEXT,
  claim_nonce TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  granted_at INTEGER,
  CHECK(status='pending' OR (device_digest IS NOT NULL AND claim_nonce IS NOT NULL AND granted_at IS NOT NULL))
);

-- Every install may be reserved by only one signup-grant owner. An account
-- can reserve multiple installations but receives its welcome grant only
-- once. Legacy accounts reserve installs as they reconnect, with no debit.
CREATE TABLE device_free_claims (
  device_digest TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claimed_at INTEGER NOT NULL
);
CREATE INDEX signup_benefit_claims_status_idx ON signup_benefit_claims(status);
CREATE INDEX device_free_claims_user_idx ON device_free_claims(user_id);
-- Reuse retained pre-feature extension sessions to detect historical claims.
CREATE INDEX sessions_signup_device_lookup_idx ON sessions(lower(device_id),user_id)
  WHERE kind='extension' AND device_id IS NOT NULL;
