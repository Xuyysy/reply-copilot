-- Source-only, apply after V1-A in LOCAL fixtures only.
-- No migration number, no automatic migration or remote D1 authorization.
-- Accrual intentionally separate from partner profile switch; exact basis and
-- commercial rollout must be independently approved before payment wiring.
INSERT INTO system_settings(key,value,updated_at)
VALUES('partner_cash_accrual_enabled','0',0),('partner_order_preview_enabled','0',0) ON CONFLICT(key) DO NOTHING;
CREATE TABLE partner_commissions (
  order_domain TEXT NOT NULL CHECK(order_domain IN ('recharge','subscription')),
  order_id TEXT NOT NULL,
  partner_user_id TEXT NOT NULL,
  buyer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_version INTEGER NOT NULL,
  paid_at INTEGER NOT NULL CHECK(typeof(paid_at)='integer' AND paid_at>0),
  applied_at INTEGER NOT NULL CHECK(typeof(applied_at)='integer' AND applied_at>=paid_at),
  basis TEXT NOT NULL CHECK(basis='product_principal'),
  currency TEXT NOT NULL CHECK(currency='CNY'),
  principal_fen INTEGER NOT NULL CHECK(typeof(principal_fen)='integer' AND principal_fen BETWEEN 1 AND 1000000000000),
  rate_bps INTEGER NOT NULL CHECK(typeof(rate_bps)='integer' AND rate_bps BETWEEN 1 AND 10000),
  commission_fen INTEGER NOT NULL CHECK(typeof(commission_fen)='integer' AND commission_fen=(principal_fen*rate_bps)/10000 AND commission_fen>0),
  hold_until INTEGER NOT NULL CHECK(typeof(hold_until)='integer' AND hold_until>=applied_at),
  created_at INTEGER NOT NULL CHECK(typeof(created_at)='integer' AND created_at>=applied_at),
  PRIMARY KEY(order_domain,order_id),
  FOREIGN KEY(partner_user_id,policy_version) REFERENCES partner_policy_versions(user_id,version) ON DELETE RESTRICT,
  CHECK(partner_user_id<>buyer_user_id)
);
CREATE INDEX partner_commissions_owner_idx ON partner_commissions(partner_user_id,paid_at DESC,order_domain,order_id);
CREATE INDEX partner_commissions_hold_idx ON partner_commissions(hold_until,order_domain,order_id);
CREATE TABLE partner_commission_refunds (
  order_domain TEXT NOT NULL,
  order_id TEXT NOT NULL,
  refund_event_id TEXT NOT NULL,
  cumulative_principal_fen INTEGER NOT NULL CHECK(typeof(cumulative_principal_fen)='integer' AND cumulative_principal_fen>0),
  cumulative_reversal_fen INTEGER NOT NULL CHECK(typeof(cumulative_reversal_fen)='integer' AND cumulative_reversal_fen>=0),
  delta_fen INTEGER NOT NULL CHECK(typeof(delta_fen)='integer' AND delta_fen<=0),
  recorded_at INTEGER NOT NULL CHECK(typeof(recorded_at)='integer' AND recorded_at>0),
  PRIMARY KEY(order_domain,order_id,refund_event_id),
  UNIQUE(order_domain,order_id,cumulative_principal_fen),
  FOREIGN KEY(order_domain,order_id) REFERENCES partner_commissions(order_domain,order_id) ON DELETE RESTRICT
);
CREATE TRIGGER partner_commissions_no_update BEFORE UPDATE ON partner_commissions
BEGIN SELECT RAISE(ABORT,'commission history is immutable'); END;
CREATE TRIGGER partner_commissions_no_delete BEFORE DELETE ON partner_commissions
BEGIN SELECT RAISE(ABORT,'commission history is immutable'); END;
CREATE TRIGGER partner_refunds_no_update BEFORE UPDATE ON partner_commission_refunds
BEGIN SELECT RAISE(ABORT,'refund history is immutable'); END;
CREATE TRIGGER partner_refunds_no_delete BEFORE DELETE ON partner_commission_refunds
BEGIN SELECT RAISE(ABORT,'refund history is immutable'); END;
