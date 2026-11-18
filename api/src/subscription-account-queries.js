// Query shared with isolated D1 query-plan tests. A 'pending', 'expired',
// 'revoked' or 'refund_pending' period is never itself spendable.
// The existing 0022_subscription_core.sql index (user_id,status,start_at,end_at)
// covers this lookup; no remote D1 migration/index creation is needed.
export const SUBSCRIPTION_RELEVANT_PERIOD_SQL = "SELECT 1 AS candidate FROM subscription_periods WHERE user_id=? AND status IN ('active','queued') LIMIT 1";
