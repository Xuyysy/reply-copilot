-- Partners V1-A, source-only proposal. Assign migration number only after
-- separate migration inventory review and operator authorization.
-- Do not place in api/migrations or execute against remote D1.
-- A partner is still an ordinary user; no changes to users.role or admin.
CREATE TABLE partner_policy_versions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version INTEGER NOT NULL CHECK(typeof(version)='integer' AND version>=1),
  status TEXT NOT NULL CHECK(status IN ('active','paused')),
  level TEXT NOT NULL CHECK(level IN ('standard','advanced','strategic')),
  rate_bps INTEGER NOT NULL CHECK(typeof(rate_bps)='integer' AND rate_bps BETWEEN 1 AND 10000),
  term_months INTEGER CHECK(term_months IS NULL OR (typeof(term_months)='integer' AND term_months BETWEEN 1 AND 120)),
  effective_at INTEGER NOT NULL CHECK(typeof(effective_at)='integer' AND effective_at>0),
  authorized_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
  PRIMARY KEY(user_id,version),
  UNIQUE(user_id,effective_at),
  CHECK(user_id<>authorized_by)
);
-- The policy row is both a historical snapshot and an audit record.
CREATE INDEX partner_policy_effective_idx ON partner_policy_versions(user_id,effective_at DESC);
CREATE TRIGGER partner_policy_no_update BEFORE UPDATE ON partner_policy_versions
BEGIN SELECT RAISE(ABORT,'partner policy history is immutable'); END;
CREATE TRIGGER partner_policy_no_delete BEFORE DELETE ON partner_policy_versions
BEGIN SELECT RAISE(ABORT,'partner policy history is immutable'); END;
INSERT INTO system_settings(key,value,updated_at)
VALUES('partner_program_enabled','0',0) ON CONFLICT(key) DO NOTHING;
