CREATE TABLE subscription_upgrade_quotes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  period_id TEXT NOT NULL REFERENCES subscription_periods(id),
  from_version_id TEXT NOT NULL REFERENCES subscription_plan_versions(id),
  to_version_id TEXT NOT NULL REFERENCES subscription_plan_versions(id),
  amount_fen INTEGER NOT NULL CHECK(amount_fen>0),
  quoted_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>quoted_at),
  period_end_at INTEGER NOT NULL,
  order_id TEXT UNIQUE REFERENCES subscription_orders(id)
);
CREATE INDEX subscription_upgrade_quotes_expiry_idx
 ON subscription_upgrade_quotes(expires_at) WHERE order_id IS NULL;

CREATE INDEX subscription_orders_finance_paid_idx
 ON subscription_orders(paid_at) WHERE paid_at IS NOT NULL;
CREATE INDEX subscription_usage_consume_time_idx
 ON subscription_usage_events(created_at) WHERE event_type='consume';
