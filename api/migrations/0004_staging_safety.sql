-- In-flight AI spend is reserved before contacting the provider.
CREATE TABLE ai_budget_days (
  budget_day TEXT PRIMARY KEY,
  reserved_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micro_usd >= 0),
  settled_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK(settled_micro_usd >= 0)
);
INSERT INTO ai_budget_days(budget_day,settled_micro_usd)
  SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch'),SUM(estimated_cost_micro_usd)
  FROM ai_usage_costs GROUP BY strftime('%Y-%m-%d',created_at/1000,'unixepoch');
ALTER TABLE ai_requests ADD COLUMN budget_day TEXT;
ALTER TABLE ai_requests ADD COLUMN budget_reserved_micro_usd INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_requests ADD COLUMN budget_finalization_ref TEXT;
CREATE UNIQUE INDEX ai_requests_budget_finalization_ref ON ai_requests(budget_finalization_ref) WHERE budget_finalization_ref IS NOT NULL;

-- Admin elevation is bound to one web session and expires quickly.
CREATE TABLE admin_mfa (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL,
  last_step INTEGER NOT NULL DEFAULT -1,
  last_elevation_ref TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE admin_mfa_pending (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  encrypted_secret TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE admin_elevations (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
