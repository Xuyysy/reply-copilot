PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email_verified_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('web','extension')),
  device_id TEXT,
  csrf_token_hash TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_idx ON sessions(user_id, expires_at);

CREATE TABLE email_verifications (
  email TEXT PRIMARY KEY COLLATE NOCASE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  used_at INTEGER,
  used_nonce TEXT
);

CREATE TABLE trials (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  CHECK (expires_at = started_at + 604800000)
);

CREATE TABLE daily_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used BETWEEN 0 AND daily_limit),
  daily_limit INTEGER NOT NULL DEFAULT 30 CHECK (daily_limit > 0),
  PRIMARY KEY (user_id, quota_date)
);
CREATE TABLE site_daily_usage (
  quota_date TEXT PRIMARY KEY,
  used INTEGER NOT NULL DEFAULT 0 CHECK (used >= 0)
);

CREATE TABLE ai_requests (
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quota_date TEXT NOT NULL,
  reservation_nonce TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('reserved','succeeded','upstream_failed','uncertain')),
  consumed INTEGER NOT NULL CHECK (consumed IN (0,1)),
  request_hash TEXT NOT NULL,
  raw_response TEXT,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  response_expires_at INTEGER,
  PRIMARY KEY (user_id, request_id)
);
CREATE INDEX ai_requests_status_idx ON ai_requests(user_id, status, created_at);
CREATE INDEX ai_requests_expiry_idx ON ai_requests(response_expires_at);

CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  license_type TEXT NOT NULL CHECK (license_type = 'lifetime'),
  status TEXT NOT NULL CHECK (status IN ('active','revoked')),
  max_devices INTEGER NOT NULL DEFAULT 2 CHECK (max_devices BETWEEN 1 AND 10),
  created_at INTEGER NOT NULL
);
CREATE TABLE license_devices (
  license_id TEXT NOT NULL REFERENCES licenses(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  PRIMARY KEY (license_id, device_id)
);

CREATE TABLE extension_authorizations (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','approved','redeemed')),
  redeem_nonce TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX extension_authorizations_expiry_idx ON extension_authorizations(expires_at);

CREATE TABLE rate_limits (
  bucket TEXT NOT NULL,
  period_start INTEGER NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 0),
  PRIMARY KEY (bucket, period_start)
);
CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  created_at INTEGER NOT NULL
);
