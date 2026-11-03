-- 0020 is already applied in Staging: never edit it or backfill requests.
-- Count only proven deliveries by their ACK timestamp. Pending/failed requests
-- do not enter this partial index; time ranges stay indexable across UTC days.
CREATE INDEX ai_requests_delivered_at_idx ON ai_requests(status,delivery_confirmed_at)
WHERE status='succeeded' AND consumed=1
  AND delivery_confirmation_id IS NOT NULL AND delivery_confirmation_id<>'';
-- No remaining application query needs (status,completed_at). It omits modern
-- ACKs with NULL completed_at and adds writes to every pending/failed request.
DROP INDEX ai_requests_status_completed_idx;
