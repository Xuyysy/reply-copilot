-- Additive candidate ONLY: apply first to an authorized Staging window.
-- No historical migration, data, balance or financial constraint is changed.
-- Local workerd rows_read / plans are recorded in docs/operations/d1-read-efficiency-2026-11-02.md.
-- Bounded global admin lists avoid sorting/reading every historical row.
CREATE INDEX users_created_id_idx ON users(created_at DESC,id);
CREATE INDEX credit_ledger_created_idx ON credit_ledger(created_at DESC);
CREATE INDEX recharge_orders_created_idx ON recharge_orders(created_at DESC);
CREATE INDEX admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);
-- The existing (user_id,status,created_at) index cannot order all statuses for
-- a user's detail/last-active query. The status+completed index bounds totals.
CREATE INDEX ai_requests_user_created_idx ON ai_requests(user_id,created_at DESC);
CREATE INDEX ai_requests_status_completed_idx ON ai_requests(status,completed_at);
-- All-provider day/month reporting currently has no date-leading index.
CREATE INDEX ai_usage_costs_created_idx ON ai_usage_costs(created_at);
