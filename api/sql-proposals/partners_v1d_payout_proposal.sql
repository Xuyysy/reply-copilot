-- Source-only proposal; requires V1-A + V1-B. Never auto-migrate.
-- Payouts are manually transferred OUTSIDE the application. No transfer API.
-- Only explicitly reviewed order balances may be reserved; hold elapsed alone
-- is insufficient. The final evidence adapter and risk checks are not wired.
INSERT INTO system_settings(key,value,updated_at)
VALUES('partner_payout_enabled','0',0) ON CONFLICT(key) DO NOTHING;
CREATE TABLE partner_payouts (
 id TEXT PRIMARY KEY,
 partner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen>0),
 status TEXT NOT NULL CHECK(status IN ('reserved','paid','cancelled')),
 created_at INTEGER NOT NULL,
 created_by TEXT NOT NULL REFERENCES users(id),
 resolved_at INTEGER,
 resolved_by TEXT REFERENCES users(id),
 transfer_reference TEXT UNIQUE,
 reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 8 AND 500),
 CHECK((status='reserved' AND resolved_at IS NULL AND resolved_by IS NULL AND transfer_reference IS NULL)
    OR (status='cancelled' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND transfer_reference IS NULL)
    OR (status='paid' AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND length(trim(transfer_reference))>0)),
 CHECK(resolved_at IS NULL OR resolved_at>=created_at)
);
CREATE UNIQUE INDEX partner_one_open_payout ON partner_payouts(partner_user_id) WHERE status='reserved';
CREATE INDEX partner_payout_owner_idx ON partner_payouts(partner_user_id,created_at DESC,id);
CREATE TABLE partner_payout_items (
 payout_id TEXT NOT NULL REFERENCES partner_payouts(id) ON DELETE RESTRICT,
 order_domain TEXT NOT NULL,
 order_id TEXT NOT NULL,
 amount_fen INTEGER NOT NULL CHECK(typeof(amount_fen)='integer' AND amount_fen>0),
 PRIMARY KEY(payout_id,order_domain,order_id),
 FOREIGN KEY(order_domain,order_id) REFERENCES partner_commissions(order_domain,order_id)
);
CREATE INDEX partner_payout_order_idx ON partner_payout_items(order_domain,order_id,payout_id);
CREATE TRIGGER partner_payout_item_no_update BEFORE UPDATE ON partner_payout_items
BEGIN SELECT RAISE(ABORT,'payout items immutable'); END;
CREATE TRIGGER partner_payout_item_no_delete BEFORE DELETE ON partner_payout_items
BEGIN SELECT RAISE(ABORT,'payout items immutable'); END;
CREATE TRIGGER partner_payout_item_guard BEFORE INSERT ON partner_payout_items
BEGIN
 SELECT CASE WHEN NOT EXISTS(
  SELECT 1 FROM partner_payouts p JOIN partner_commissions c ON c.partner_user_id=p.partner_user_id
  WHERE p.id=NEW.payout_id AND p.status='reserved' AND c.order_domain=NEW.order_domain AND c.order_id=NEW.order_id
  AND c.hold_until<=p.created_at
  AND NEW.amount_fen<=c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)
  -COALESCE((SELECT SUM(i.amount_fen) FROM partner_payout_items i JOIN partner_payouts q ON q.id=i.payout_id WHERE i.order_domain=c.order_domain AND i.order_id=c.order_id AND q.status IN ('reserved','paid')),0)
 ) THEN RAISE(ABORT,'payout item invalid') END;
END;
CREATE TRIGGER partner_payout_no_delete BEFORE DELETE ON partner_payouts
BEGIN SELECT RAISE(ABORT,'payout history immutable'); END;
CREATE TRIGGER partner_payout_transition BEFORE UPDATE ON partner_payouts
BEGIN
 SELECT CASE WHEN OLD.status<>'reserved' OR NEW.status NOT IN ('paid','cancelled')
 OR NEW.id<>OLD.id OR NEW.partner_user_id<>OLD.partner_user_id OR NEW.amount_fen<>OLD.amount_fen
 OR NEW.created_at<>OLD.created_at OR NEW.created_by<>OLD.created_by OR NEW.reason<>OLD.reason
 THEN RAISE(ABORT,'payout transition invalid') END;
 SELECT CASE WHEN NEW.status='paid' AND (
   (SELECT COALESCE(SUM(i.amount_fen),0) FROM partner_payout_items i WHERE i.payout_id=OLD.id)<>OLD.amount_fen
   OR EXISTS(SELECT 1 FROM partner_payout_items i JOIN partner_commissions c ON c.order_domain=i.order_domain AND c.order_id=i.order_id
     WHERE i.payout_id=OLD.id AND i.amount_fen>c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0)
      -COALESCE((SELECT SUM(j.amount_fen) FROM partner_payout_items j JOIN partner_payouts p ON p.id=j.payout_id WHERE j.order_domain=c.order_domain AND j.order_id=c.order_id AND p.status='paid'),0))
 ) THEN RAISE(ABORT,'payout requires reconciliation') END;
END;

-- Refund debt across ALL orders must be offset before any new reservation.
CREATE TRIGGER partner_payout_balance_guard BEFORE INSERT ON partner_payouts
BEGIN
 SELECT CASE WHEN NEW.status<>'reserved' OR NEW.amount_fen>
  COALESCE((SELECT SUM(c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r
    WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0))
    FROM partner_commissions c WHERE c.partner_user_id=NEW.partner_user_id AND c.hold_until<=NEW.created_at),0)
  -COALESCE((SELECT SUM(p.amount_fen) FROM partner_payouts p
    WHERE p.partner_user_id=NEW.partner_user_id AND p.status IN ('reserved','paid')),0)
 THEN RAISE(ABORT,'insufficient partner net balance') END;
END;
-- A refund on a different order can reduce net funds during reservation.
CREATE TRIGGER partner_payout_net_confirm_guard BEFORE UPDATE ON partner_payouts
WHEN NEW.status='paid'
BEGIN
 SELECT CASE WHEN
  COALESCE((SELECT SUM(c.commission_fen+COALESCE((SELECT SUM(r.delta_fen) FROM partner_commission_refunds r
    WHERE r.order_domain=c.order_domain AND r.order_id=c.order_id),0))
    FROM partner_commissions c WHERE c.partner_user_id=OLD.partner_user_id AND c.hold_until<=OLD.created_at),0)
  <COALESCE((SELECT SUM(p.amount_fen) FROM partner_payouts p
    WHERE p.partner_user_id=OLD.partner_user_id AND p.status IN ('reserved','paid')),0)
 THEN RAISE(ABORT,'payout requires reconciliation') END;
END;
