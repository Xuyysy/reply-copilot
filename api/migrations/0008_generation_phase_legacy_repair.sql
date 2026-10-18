-- `status='succeeded'` is the existing terminal outcome. `generation_phase`
-- has no completed value, and the migration-added default must not make old
-- completed rows look like active generation. Their historical phase is not
-- recoverable, so mark only safely completed legacy rows as `unknown`.
-- Keep requests with in-flight reservations or a delivery confirmation out.
UPDATE ai_requests
SET generation_phase='unknown'
WHERE status='succeeded'
  AND consumed=1
  AND generation_phase='generating'
  AND delivery_confirmed_at IS NULL
  AND delivery_confirmation_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM ai_credit_allocations a
    WHERE a.user_id=ai_requests.user_id
      AND a.request_id=ai_requests.request_id
      AND a.state='reserved'
  );
