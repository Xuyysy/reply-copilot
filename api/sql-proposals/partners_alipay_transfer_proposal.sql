-- Source-only proposal, after V1-A/B/D + recipient. Never auto-migrate.
-- External Alipay transfers are manual; these records do NOT initiate money movement.
-- No public write routes until independent commercial, risk and D1 review.
CREATE TABLE partner_alipay_requests (
 id TEXT PRIMARY KEY,
 partner_user_id TEXT NOT NULL,
 recipient_version INTEGER NOT NULL,
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen>0 AND amount_fen<=1000000000000),
 created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>0),
 status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
 payout_id TEXT UNIQUE REFERENCES partner_payouts(id),
 reviewed_by TEXT REFERENCES users(id),
 reviewed_at INTEGER,
 reason TEXT,
 FOREIGN KEY(partner_user_id,recipient_version) REFERENCES partner_alipay_recipients(user_id,version),
 CHECK((status='pending' AND payout_id IS NULL AND reviewed_by IS NULL AND reviewed_at IS NULL AND reason IS NULL)
 OR (status='approved' AND payout_id IS NOT NULL AND reviewed_by IS NOT NULL AND reviewed_at>=created_at AND length(trim(reason))>=8)
 OR (status='rejected' AND payout_id IS NULL AND reviewed_by IS NOT NULL AND reviewed_at>=created_at AND length(trim(reason))>=8))
);
CREATE UNIQUE INDEX partner_alipay_request_open ON partner_alipay_requests(partner_user_id) WHERE status='pending';
CREATE INDEX partner_alipay_request_owner ON partner_alipay_requests(partner_user_id,created_at DESC,id);
CREATE TRIGGER partner_alipay_request_no_delete BEFORE DELETE ON partner_alipay_requests
BEGIN SELECT RAISE(ABORT,'request history immutable'); END;
CREATE TRIGGER partner_alipay_request_transition BEFORE UPDATE ON partner_alipay_requests
BEGIN
 SELECT CASE WHEN OLD.status<>'pending' OR NEW.status NOT IN ('approved','rejected') OR NEW.id<>OLD.id
 OR NEW.partner_user_id<>OLD.partner_user_id OR NEW.recipient_version<>OLD.recipient_version
 OR NEW.amount_fen<>OLD.amount_fen OR NEW.created_at<>OLD.created_at
 THEN RAISE(ABORT,'invalid request transition') END;
 SELECT CASE WHEN NEW.status='approved' AND NOT EXISTS(
 SELECT 1 FROM partner_payouts p JOIN partner_alipay_payout_destinations d ON d.payout_id=p.id
 WHERE p.id=NEW.payout_id AND p.status='reserved' AND p.partner_user_id=OLD.partner_user_id
 AND p.amount_fen=OLD.amount_fen AND d.user_id=OLD.partner_user_id AND d.recipient_version=OLD.recipient_version
 AND (SELECT COALESCE(SUM(i.amount_fen),0) FROM partner_payout_items i WHERE i.payout_id=p.id)=p.amount_fen
 ) THEN RAISE(ABORT,'request requires exact reserved payout') END;
END;
-- One transfer authorization per payout, never retry an uncertain transfer.
CREATE TABLE partner_alipay_transfer_starts (
 payout_id TEXT PRIMARY KEY REFERENCES partner_payouts(id) ON DELETE RESTRICT,
 started_by TEXT NOT NULL REFERENCES users(id),
 started_at INTEGER NOT NULL CHECK(typeof(started_at)='integer' AND started_at>0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500)
);
CREATE TABLE partner_alipay_transfer_outcomes (
 payout_id TEXT PRIMARY KEY REFERENCES partner_alipay_transfer_starts(payout_id) ON DELETE RESTRICT,
 outcome TEXT NOT NULL CHECK(outcome IN ('paid','no_transfer')),
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen>=0),
 reference TEXT UNIQUE,
 recorded_by TEXT NOT NULL REFERENCES users(id),
 recorded_at INTEGER NOT NULL CHECK(typeof(recorded_at)='integer' AND recorded_at>0),
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 CHECK((outcome='paid' AND amount_fen>0 AND reference IS NOT NULL AND length(trim(reference)) BETWEEN 1 AND 160)
 OR (outcome='no_transfer' AND amount_fen=0 AND reference IS NULL))
);
CREATE TRIGGER partner_alipay_start_no_update BEFORE UPDATE ON partner_alipay_transfer_starts
BEGIN SELECT RAISE(ABORT,'transfer start immutable'); END;
CREATE TRIGGER partner_alipay_start_no_delete BEFORE DELETE ON partner_alipay_transfer_starts
BEGIN SELECT RAISE(ABORT,'transfer start immutable'); END;
CREATE TRIGGER partner_alipay_outcome_no_update BEFORE UPDATE ON partner_alipay_transfer_outcomes
BEGIN SELECT RAISE(ABORT,'transfer outcome immutable'); END;
CREATE TRIGGER partner_alipay_outcome_no_delete BEFORE DELETE ON partner_alipay_transfer_outcomes
BEGIN SELECT RAISE(ABORT,'transfer outcome immutable'); END;
-- Lock before viewing the full destination or moving money. Recheck current
-- ledger net at this point. Provider risk evidence must also be checked by the
-- future trusted adapter; this trigger cannot establish external payment truth.
CREATE TRIGGER partner_alipay_start_guard BEFORE INSERT ON partner_alipay_transfer_starts
BEGIN
 SELECT CASE WHEN NOT EXISTS(
 SELECT 1 FROM partner_payouts p JOIN partner_alipay_payout_destinations d ON d.payout_id=p.id
 JOIN partner_alipay_requests q ON q.payout_id=p.id AND q.status='approved'
 WHERE p.id=NEW.payout_id AND p.status='reserved' AND NEW.started_at>=p.created_at
 AND EXISTS(SELECT 1 FROM users u WHERE u.id=p.partner_user_id AND u.role='user' AND u.status='active' AND u.email_verified_at IS NOT NULL AND u.archived_at IS NULL AND u.is_test_account=0)
 AND (SELECT COALESCE(SUM(i.amount_fen),0) FROM partner_payout_items i WHERE i.payout_id=p.id)=p.amount_fen
 AND NOT EXISTS(SELECT 1 FROM partner_payout_items i JOIN partner_commissions c ON c.order_domain=i.order_domain AND c.order_id=i.order_id
 WHERE i.payout_id=p.id AND i.amount_fen>c.commission_fen+
 COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)
 -COALESCE((SELECT SUM(j.amount_fen) FROM partner_payout_items j JOIN partner_payouts h ON h.id=j.payout_id
 WHERE j.order_domain=c.order_domain AND j.order_id=c.order_id AND h.status='paid'),0))
 AND COALESCE((SELECT SUM(c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r
 WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)) FROM partner_commissions c
 WHERE c.partner_user_id=p.partner_user_id AND c.hold_until<=NEW.started_at),0)
 >=COALESCE((SELECT SUM(h.amount_fen) FROM partner_payouts h WHERE h.partner_user_id=p.partner_user_id AND h.status IN ('reserved','paid')),0)
 ) THEN RAISE(ABORT,'transfer requires reconciliation') END;
END;
CREATE TRIGGER partner_alipay_outcome_guard BEFORE INSERT ON partner_alipay_transfer_outcomes
BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM partner_payouts p JOIN partner_alipay_transfer_starts s ON s.payout_id=p.id
 WHERE p.id=NEW.payout_id AND p.status='reserved' AND NEW.recorded_at>=s.started_at
 AND (NEW.outcome='no_transfer' OR NEW.amount_fen=p.amount_fen))
 THEN RAISE(ABORT,'invalid transfer outcome') END;
END;
-- Replace source-only legacy triggers, moving the financial recheck BEFORE
-- transfer. Actual confirmed payment must be recorded even after a refund.
-- The remaining debt is reflected by the immutable paid and refund ledgers.
DROP TRIGGER partner_payout_transition;
DROP TRIGGER partner_payout_net_confirm_guard;
CREATE TRIGGER partner_payout_transition BEFORE UPDATE ON partner_payouts
BEGIN
 SELECT CASE WHEN OLD.status<>'reserved' OR NEW.status NOT IN ('paid','cancelled')
 OR NEW.id<>OLD.id OR NEW.partner_user_id<>OLD.partner_user_id OR NEW.amount_fen<>OLD.amount_fen
 OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by OR NEW.reason<>OLD.reason
 THEN RAISE(ABORT,'payout transition invalid') END;
 SELECT CASE WHEN NEW.status='paid' AND NOT EXISTS(
 SELECT 1 FROM partner_alipay_transfer_outcomes e WHERE e.payout_id=OLD.id AND e.outcome='paid'
 AND e.amount_fen=OLD.amount_fen AND e.reference=NEW.transfer_reference
 AND e.recorded_at=NEW.resolved_at AND e.recorded_by=NEW.resolved_by)
 THEN RAISE(ABORT,'confirmed transfer evidence required') END;
 SELECT CASE WHEN NEW.status='cancelled' AND EXISTS(SELECT 1 FROM partner_alipay_transfer_starts s WHERE s.payout_id=OLD.id)
 AND NOT EXISTS(SELECT 1 FROM partner_alipay_transfer_outcomes e WHERE e.payout_id=OLD.id AND e.outcome='no_transfer'
 AND e.recorded_at=NEW.resolved_at AND e.recorded_by=NEW.resolved_by)
 THEN RAISE(ABORT,'unknown transfer remains locked') END;
END;
-- Evidence and ledger update are atomic, even if the accrual/payout switch is
-- now off. A successful transfer is a financial fact, not a new authorization.
CREATE TRIGGER partner_alipay_outcome_apply AFTER INSERT ON partner_alipay_transfer_outcomes
BEGIN
 UPDATE partner_payouts SET status=CASE WHEN NEW.outcome='paid' THEN 'paid' ELSE 'cancelled' END,
 resolved_at=NEW.recorded_at,resolved_by=NEW.recorded_by,transfer_reference=NEW.reference WHERE id=NEW.payout_id;
END;

-- Once an application is approved its payout item set is sealed.
CREATE TRIGGER partner_alipay_items_sealed BEFORE INSERT ON partner_payout_items
WHEN EXISTS(SELECT 1 FROM partner_alipay_requests q WHERE q.payout_id=NEW.payout_id AND q.status='approved')
BEGIN SELECT RAISE(ABORT,'approved payout items sealed'); END;
