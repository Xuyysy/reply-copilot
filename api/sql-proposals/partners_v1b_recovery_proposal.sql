-- Source-only proposal. Apply to synthetic fixtures after V1-A/B only.
-- No migration number; no production D1 access or activation authorization.
-- Explicit, immutable activation windows prevent old orders and disabled
-- intervals from being retroactively commissioned. No seeded active window.
CREATE TABLE partner_accrual_windows (
 id TEXT PRIMARY KEY,
 starts_at INTEGER NOT NULL CHECK(typeof(starts_at)='integer' AND starts_at>0),
 ends_at INTEGER CHECK(ends_at IS NULL OR (typeof(ends_at)='integer' AND ends_at>starts_at)),
 basis TEXT NOT NULL CHECK(basis='product_principal'),
 hold_ms INTEGER NOT NULL CHECK(typeof(hold_ms)='integer' AND hold_ms BETWEEN 1 AND 31536000000),
 authorized_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500)
);
CREATE UNIQUE INDEX partner_one_active_accrual_window ON partner_accrual_windows((1)) WHERE ends_at IS NULL;
CREATE TRIGGER partner_accrual_window_no_overlap BEFORE INSERT ON partner_accrual_windows
BEGIN SELECT CASE WHEN NEW.ends_at IS NOT NULL OR EXISTS(
 SELECT 1 FROM partner_accrual_windows w WHERE w.ends_at IS NULL OR w.ends_at>NEW.starts_at
 ) THEN RAISE(ABORT,'accrual window overlap') END; END;
CREATE TRIGGER partner_accrual_window_close_only BEFORE UPDATE ON partner_accrual_windows
BEGIN SELECT CASE WHEN OLD.ends_at IS NOT NULL OR NEW.ends_at IS NULL OR NEW.ends_at<=OLD.starts_at
 OR NEW.id<>OLD.id OR NEW.starts_at<>OLD.starts_at OR NEW.basis<>OLD.basis OR NEW.hold_ms<>OLD.hold_ms
 OR NEW.authorized_by<>OLD.authorized_by OR NEW.reason<>OLD.reason
 THEN RAISE(ABORT,'accrual window immutable') END; END;
CREATE TRIGGER partner_accrual_window_no_delete BEFORE DELETE ON partner_accrual_windows
BEGIN SELECT RAISE(ABORT,'accrual window immutable'); END;
-- Durable recovery work, one row per source order. No user-provided monetary
-- facts; a future trusted adapter rereads evidence before every attempt.
CREATE TABLE partner_accrual_jobs (
 order_domain TEXT NOT NULL CHECK(order_domain IN ('recharge','subscription')),
 order_id TEXT NOT NULL,
 window_id TEXT NOT NULL REFERENCES partner_accrual_windows(id),
 paid_at INTEGER NOT NULL CHECK(typeof(paid_at)='integer' AND paid_at>0),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=paid_at),
 state TEXT NOT NULL CHECK(state IN ('pending','review','done')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(typeof(attempts)='integer' AND attempts BETWEEN 0 AND 20),
 next_attempt_at INTEGER NOT NULL CHECK(typeof(next_attempt_at)='integer' AND next_attempt_at>=created_at),
 last_code TEXT NOT NULL CHECK(length(last_code) BETWEEN 1 AND 80),
 updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(order_domain,order_id)
);
CREATE INDEX partner_accrual_due ON partner_accrual_jobs(state,next_attempt_at,order_domain,order_id);
CREATE TRIGGER partner_accrual_job_no_delete BEFORE DELETE ON partner_accrual_jobs
BEGIN SELECT RAISE(ABORT,'accrual recovery history retained'); END;
CREATE TRIGGER partner_accrual_job_guard BEFORE UPDATE ON partner_accrual_jobs
BEGIN SELECT CASE WHEN OLD.state='done' OR NEW.order_domain<>OLD.order_domain OR NEW.order_id<>OLD.order_id
 OR NEW.window_id<>OLD.window_id OR NEW.paid_at<>OLD.paid_at OR NEW.created_at<>OLD.created_at
 OR NEW.updated_at<OLD.updated_at OR NEW.attempts<>OLD.attempts+1
 THEN RAISE(ABORT,'invalid accrual recovery transition') END;
 SELECT CASE WHEN NEW.state='done' AND NOT EXISTS(SELECT 1 FROM partner_commissions c
 WHERE c.order_domain=NEW.order_domain AND c.order_id=NEW.order_id AND c.paid_at=NEW.paid_at)
 THEN RAISE(ABORT,'commission not recorded') END; END;

-- Transaction-local invariant assertions. Any false assertion aborts the
-- entire D1.batch; rows are removed in the same successful batch.
CREATE TABLE partner_recovery_assertions (
 id TEXT PRIMARY KEY,
 ok INTEGER NOT NULL CHECK(ok=1)
);

-- Default-off non-production single-order review. Manual risk review is not a provider attestation.
INSERT INTO system_settings(key,value,updated_at) VALUES('partner_accrual_review_enabled','0',0) ON CONFLICT(key) DO NOTHING;
CREATE TABLE partner_accrual_review_audits (
 operation_id TEXT PRIMARY KEY,
 order_domain TEXT NOT NULL,
 order_id TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 reviewed_at INTEGER NOT NULL CHECK(typeof(reviewed_at)='integer' AND reviewed_at>0),
 FOREIGN KEY(order_domain,order_id) REFERENCES partner_commissions(order_domain,order_id)
);
CREATE TRIGGER partner_review_audit_no_update BEFORE UPDATE ON partner_accrual_review_audits
BEGIN SELECT RAISE(ABORT,'review audit immutable'); END;
CREATE TRIGGER partner_review_audit_no_delete BEFORE DELETE ON partner_accrual_review_audits
BEGIN SELECT RAISE(ABORT,'review audit immutable'); END;
