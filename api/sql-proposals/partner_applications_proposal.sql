-- Source-only proposal; apply with separate environment-specific authorization.
CREATE TABLE partner_applications (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 x_handle TEXT NOT NULL CHECK(length(x_handle) BETWEEN 1 AND 15 AND x_handle NOT GLOB '*[^a-z0-9_]*'),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 reviewed_at INTEGER,
 reviewed_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 review_reason TEXT,
 CHECK((status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL AND review_reason IS NULL) OR
 (status IN ('approved','rejected') AND reviewed_at IS NOT NULL AND reviewed_at>=created_at AND reviewed_by IS NOT NULL AND review_reason IS NOT NULL AND length(trim(review_reason)) BETWEEN 8 AND 500))
);
CREATE UNIQUE INDEX partner_application_pending_idx ON partner_applications(user_id) WHERE status='pending';
CREATE INDEX partner_application_user_idx ON partner_applications(user_id,created_at DESC,id DESC);
CREATE INDEX partner_application_queue_idx ON partner_applications(status,created_at,id);
CREATE TRIGGER partner_application_review_guard BEFORE UPDATE ON partner_applications
 WHEN OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.id<>OLD.id OR NEW.user_id<>OLD.user_id OR NEW.x_handle<>OLD.x_handle OR NEW.created_at<>OLD.created_at
 BEGIN SELECT RAISE(ABORT,'application review is immutable'); END;
-- Existing explicit administrator authorization remains valid and marks a
-- pending application approved in the same transaction as the first policy.
CREATE TRIGGER partner_application_policy_approved AFTER INSERT ON partner_policy_versions
 WHEN NEW.version=1 AND NEW.status='active'
 BEGIN
 UPDATE partner_applications SET status='approved',reviewed_at=NEW.effective_at,reviewed_by=NEW.authorized_by,review_reason=NEW.reason
 WHERE user_id=NEW.user_id AND status='pending';
 END;
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_applications_enabled','0',0) ON CONFLICT(key) DO NOTHING;
