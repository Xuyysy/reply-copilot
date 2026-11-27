-- Source-only proposal: manual settlement requests, not a payment engine.
-- No automatic migration, recipient data, payment credentials or transfers.
-- Prerequisite: reviewed V1-A policy schema.
CREATE TABLE partner_manual_requests (
 id TEXT PRIMARY KEY,
 partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen BETWEEN 1000 AND 1000000000000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','rejected')),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 resolved_at INTEGER,
 resolved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT,
 CHECK((status='pending' AND resolved_at IS NULL AND resolved_by IS NULL AND reason IS NULL) OR
 (status IN ('completed','rejected') AND resolved_at>=created_at AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolved_by<>partner_user_id AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 8 AND 500))
);
CREATE UNIQUE INDEX partner_manual_one_pending_idx ON partner_manual_requests(partner_user_id) WHERE status='pending';
CREATE INDEX partner_manual_requests_owner_idx ON partner_manual_requests(partner_user_id,created_at DESC,id);
CREATE INDEX partner_manual_requests_queue_idx ON partner_manual_requests(status,created_at,id);
CREATE TRIGGER partner_manual_request_transition BEFORE UPDATE ON partner_manual_requests
 WHEN OLD.status<>'pending' OR NEW.status NOT IN ('completed','rejected') OR NEW.id<>OLD.id OR NEW.partner_user_id<>OLD.partner_user_id OR NEW.amount_fen<>OLD.amount_fen OR NEW.created_at<>OLD.created_at
 BEGIN SELECT RAISE(ABORT,'manual request transition invalid'); END;
CREATE TRIGGER partner_manual_request_no_delete BEFORE DELETE ON partner_manual_requests
 BEGIN SELECT RAISE(ABORT,'manual request cannot be deleted'); END;
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_manual_reporting_enabled','0',0) ON CONFLICT(key) DO NOTHING;
