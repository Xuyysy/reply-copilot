// Shared with the local query-plan/rows-read regression harness. Bound values
// remain parameters; no identifiers or user input are interpolated.
// Explicit indexable branches avoid the full-table OR plan observed in local
// workerd even when the NOCASE branch can use the existing partial index.
export const LOGIN_USER_SQL = 'SELECT id,password_hash,status FROM users WHERE email=? UNION ALL SELECT id,password_hash,status FROM users WHERE username=? COLLATE NOCASE LIMIT 1';
export const REGISTRATION_IDENTITY_SQL = 'SELECT id FROM users WHERE email=? UNION ALL SELECT id FROM users WHERE username=? COLLATE NOCASE LIMIT 1';
export const RECENT_LEDGER_SQL = `SELECT credit_ledger.*,users.email FROM credit_ledger
  JOIN users ON users.id=credit_ledger.user_id ORDER BY credit_ledger.created_at DESC LIMIT 100`;
export const USER_USAGE_SQL = 'SELECT request_id id,status,generation_phase,created_at,completed_at FROM ai_requests WHERE user_id=? ORDER BY created_at DESC LIMIT 100';
export const GENERATION_TOTALS_SQL = `SELECT COUNT(*) monthGenerations,
  COALESCE(SUM(CASE WHEN completed_at>=? THEN 1 ELSE 0 END),0) todayGenerations
  FROM ai_requests WHERE status='succeeded' AND completed_at>=?`;
