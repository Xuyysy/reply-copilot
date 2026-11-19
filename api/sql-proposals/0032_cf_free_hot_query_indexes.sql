-- SOURCE-ONLY index candidates. NEVER apply to Staging or Production without
-- explicit D1 migration approval, full backup, isolated test, and write-budget review.
-- Existing business/financial semantics are unchanged.
CREATE INDEX cf_free_ai_delivered_user_count_idx
  ON ai_requests(user_id,status,consumed,delivery_confirmed_at)
  WHERE status='succeeded' AND consumed=1
    AND delivery_confirmation_id IS NOT NULL AND delivery_confirmation_id<>''
    AND delivery_confirmed_at IS NOT NULL;

-- Global bounded admin event timeline currently has only a period-leading index.
-- This partial index excludes 'reserve' rows intentionally hidden from that view.
CREATE INDEX cf_free_subscription_events_recent_idx
  ON subscription_usage_events(created_at DESC,id DESC)
  WHERE event_type<>'reserve';
