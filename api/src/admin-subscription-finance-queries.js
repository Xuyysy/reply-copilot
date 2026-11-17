// Expensive 30-day historical usage/cost report, available only after the
// administrator explicitly requests the exact subscriber usage breakdown.
// Keep this SQL shared between Production and isolated D1 benchmarks.
export const SUBSCRIPTION_30D_USAGE_SQL = `SELECT
    (SELECT COUNT(*) FROM subscription_usage_events WHERE created_at>=? AND event_type='consume') consumed,
    (SELECT COALESCE(SUM(c.estimated_cost_micro_usd),0) FROM ai_usage_costs c
      JOIN subscription_ai_allocations a ON a.user_id=c.user_id AND a.request_id=c.request_id
      WHERE c.created_at>=?) cost_micro_usd`;
