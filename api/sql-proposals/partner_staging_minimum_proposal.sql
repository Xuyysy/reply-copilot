-- Staging ONLY: allow a single existing partner to submit >=200 fen until expiry.
-- Never apply in Production. Requires 0036 and an empty request table with no
-- snapshots or request-linked reveal audit records. Run atomically, after
-- preflight and tested Worker release; do not execute against a nonempty table.
CREATE TABLE partner_staging_minimum_migration_guard(ok INTEGER NOT NULL CHECK(ok=1));
INSERT INTO partner_staging_minimum_migration_guard(ok)
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partner_manual_requests)
 AND NOT EXISTS(SELECT 1 FROM partner_request_recipients)
 AND NOT EXISTS(SELECT 1 FROM partner_payout_reveal_audit WHERE request_id IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM system_settings WHERE key='partner_staging_min_request_user') THEN 1 ELSE 0 END;
DROP TABLE partner_staging_minimum_migration_guard;
DROP TRIGGER partner_payout_profile_pending_lock;
DROP TABLE partner_manual_requests;
CREATE TABLE partner_manual_requests (
 id TEXT PRIMARY KEY,
 partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen BETWEEN 200 AND 1000000000000),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','rejected')),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 resolved_at INTEGER,
 resolved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
 reason TEXT,
 CHECK((status='pending' AND resolved_at IS NULL AND resolved_by IS NULL AND reason IS NULL) OR
 (status IN ('completed','rejected') AND typeof(resolved_at)='integer' AND resolved_at>=created_at AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolved_by<>partner_user_id AND reason IS NOT NULL AND length(trim(reason)) BETWEEN 8 AND 500))
);
CREATE UNIQUE INDEX partner_manual_one_pending_idx ON partner_manual_requests(partner_user_id) WHERE status='pending';
CREATE INDEX partner_manual_requests_owner_idx ON partner_manual_requests(partner_user_id,created_at DESC,id);
CREATE INDEX partner_manual_requests_queue_idx ON partner_manual_requests(status,created_at,id);
CREATE TRIGGER partner_manual_request_transition BEFORE UPDATE ON partner_manual_requests
 WHEN OLD.status<>'pending' OR NEW.status NOT IN ('completed','rejected') OR NEW.id<>OLD.id OR NEW.partner_user_id<>OLD.partner_user_id OR NEW.amount_fen<>OLD.amount_fen OR NEW.created_at<>OLD.created_at
 BEGIN SELECT RAISE(ABORT,'manual request transition invalid'); END;
CREATE TRIGGER partner_manual_request_no_delete BEFORE DELETE ON partner_manual_requests
 BEGIN SELECT RAISE(ABORT,'manual request cannot be deleted'); END;
CREATE TRIGGER partner_payout_profile_pending_lock BEFORE INSERT ON partner_payout_profiles
 WHEN EXISTS(SELECT 1 FROM partner_manual_requests WHERE partner_user_id=NEW.user_id AND status='pending')
 BEGIN SELECT RAISE(ABORT,'pending settlement locks recipient'); END;
CREATE TRIGGER partner_payout_profile_required BEFORE INSERT ON partner_manual_requests
 WHEN EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_profile_enabled' AND value='1')
 AND NOT EXISTS(SELECT 1 FROM partner_payout_profiles WHERE user_id=NEW.partner_user_id)
 BEGIN SELECT RAISE(ABORT,'payout profile required'); END;
CREATE TRIGGER partner_payout_recipient_snapshot AFTER INSERT ON partner_manual_requests
 WHEN EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_profile_enabled' AND value='1')
 BEGIN INSERT INTO partner_request_recipients(request_id,user_id,profile_version)
 SELECT NEW.id,NEW.partner_user_id,MAX(version) FROM partner_payout_profiles WHERE user_id=NEW.partner_user_id; END;
CREATE TRIGGER partner_payout_legacy_completion_guard BEFORE UPDATE ON partner_manual_requests
 WHEN NEW.status='completed' AND EXISTS(SELECT 1 FROM system_settings WHERE key='partner_payout_profile_enabled' AND value='1')
 AND NOT EXISTS(SELECT 1 FROM partner_request_recipients WHERE request_id=NEW.id)
 BEGIN SELECT RAISE(ABORT,'settlement has no verified recipient snapshot'); END;
CREATE TRIGGER partner_commission_settled AFTER UPDATE OF status ON partner_manual_requests
 WHEN OLD.status='pending' AND NEW.status='completed'
 BEGIN
 INSERT INTO partner_commission_totals(partner_user_id,settled_fen) VALUES(NEW.partner_user_id,NEW.amount_fen)
 ON CONFLICT(partner_user_id) DO UPDATE SET settled_fen=settled_fen+excluded.settled_fen;
 END;
CREATE TRIGGER partner_commission_request_guard BEFORE INSERT ON partner_manual_requests
 WHEN COALESCE((SELECT value FROM system_settings WHERE key='partner_commission_ledger_enabled'),'0')='1'
 AND (EXISTS(SELECT 1 FROM partner_commission_dirty q WHERE q.partner_user_id=NEW.partner_user_id)
 OR NEW.amount_fen<>COALESCE((SELECT earned_fen-settled_fen FROM partner_commission_totals WHERE partner_user_id=NEW.partner_user_id),0))
 BEGIN SELECT RAISE(ABORT,'commission balance changed'); END;
CREATE TRIGGER partner_manual_request_minimum_guard BEFORE INSERT ON partner_manual_requests
 WHEN NEW.amount_fen<1000 AND NOT EXISTS(SELECT 1 FROM system_settings s WHERE s.key='partner_staging_min_request_user' AND s.value=NEW.partner_user_id AND s.updated_at>CAST(unixepoch('now') AS INTEGER)*1000)
 BEGIN SELECT RAISE(ABORT,'manual settlement minimum not reached'); END;
-- Expiry is stored in updated_at for this single purpose setting. The setting
-- is deliberately not seeded; owner authorizes its short-lived activation.
