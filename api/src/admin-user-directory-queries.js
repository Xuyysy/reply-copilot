// Admin directory must be a bounded user/credit-account listing.
// Do not add lifetime ai_requests counts or correlated cross-ledger activity
// queries to this hot path: on current Production history they cost >1m D1
// rows per directory request, amplified by dashboard refreshes. Those exact
// metrics remain available only after opening one authorized user detail.
export const ADMIN_USER_DIRECTORY_SELECT = `SELECT
  u.id,u.username,u.email,u.email_verified_at,u.created_at,
  u.status,u.role,u.is_test_account,u.archived_at,u.admin_note,
  COALESCE(a.free_balance,0) free_balance,
  COALESCE(a.paid_balance,0) paid_balance,
  CAST(NULL AS INTEGER) last_active_at,
  CAST(NULL AS INTEGER) generations
FROM users u LEFT JOIN credit_accounts a ON a.user_id=u.id`;

// Same ACK-proven semantics as the previous directory count, but evaluated
// only for the explicitly selected user, never for every directory row.
export const ADMIN_EXACT_GENERATIONS_SQL = `SELECT COUNT(*) generations
FROM ai_requests r WHERE r.user_id=? AND r.status='succeeded'
  AND r.consumed=1
  AND r.delivery_confirmation_id IS NOT NULL
  AND r.delivery_confirmation_id<>''
  AND r.delivery_confirmed_at IS NOT NULL`;
