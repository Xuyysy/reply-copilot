-- SOURCE-ONLY / EXPERIMENT. DO NOT apply to any remote D1.
-- The current full expiry index maintains entries for NULL deadlines on
-- reservation insertion; normal expiry queries explicitly require non-NULL.
-- This replacement may save writes but can hurt IS NULL timeout queries.
-- Evaluate real local generate/ACK + cleanup plans before any decision.
DROP INDEX ai_requests_expiry_idx;
CREATE INDEX ai_requests_expiry_idx ON ai_requests(response_expires_at)
  WHERE response_expires_at IS NOT NULL;
-- Rollback (separate authorized operation, NOT automatically executed):
-- DROP INDEX ai_requests_expiry_idx;
-- CREATE INDEX ai_requests_expiry_idx ON ai_requests(response_expires_at);
