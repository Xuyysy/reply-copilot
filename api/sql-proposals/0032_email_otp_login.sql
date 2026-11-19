-- PROPOSAL ONLY: do not apply automatically to Production or Staging D1.
-- Separate owner approval required for any remote D1 SQL, including SELECT.
CREATE TABLE email_login_challenges (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  consumed_at INTEGER,
  consumed_nonce TEXT
);
CREATE INDEX email_login_challenges_expiry_idx ON email_login_challenges(expires_at);
