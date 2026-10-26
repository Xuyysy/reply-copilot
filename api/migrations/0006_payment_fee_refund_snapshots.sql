-- Freeze the customer-facing principal, handling fee and total per payment.
-- Historical transactions keep their original gross amount and are treated as
-- principal-only snapshots because their historical fee cannot be inferred.
ALTER TABLE payment_transactions ADD COLUMN base_amount_fen INTEGER NOT NULL DEFAULT 0 CHECK(base_amount_fen >= 0);
ALTER TABLE payment_transactions ADD COLUMN service_fee_fen INTEGER NOT NULL DEFAULT 0 CHECK(service_fee_fen >= 0);
ALTER TABLE payment_transactions ADD COLUMN fee_rate_bps INTEGER NOT NULL DEFAULT 0 CHECK(fee_rate_bps BETWEEN 0 AND 10000);
ALTER TABLE payment_transactions ADD COLUMN principal_refunded_fen INTEGER NOT NULL DEFAULT 0 CHECK(principal_refunded_fen >= 0);
ALTER TABLE payment_transactions ADD COLUMN service_fee_refunded_fen INTEGER NOT NULL DEFAULT 0 CHECK(service_fee_refunded_fen >= 0);
ALTER TABLE payment_transactions ADD COLUMN fee_snapshot_version TEXT NOT NULL DEFAULT 'legacy-v0';
UPDATE payment_transactions SET base_amount_fen=amount_fen WHERE base_amount_fen=0;

ALTER TABLE payment_refunds ADD COLUMN base_amount_fen INTEGER NOT NULL DEFAULT 0 CHECK(base_amount_fen >= 0);
ALTER TABLE payment_refunds ADD COLUMN service_fee_amount_fen INTEGER NOT NULL DEFAULT 0 CHECK(service_fee_amount_fen >= 0);
ALTER TABLE payment_refunds ADD COLUMN refund_kind TEXT NOT NULL DEFAULT 'special' CHECK(refund_kind IN ('ordinary','special'));
ALTER TABLE payment_refunds ADD COLUMN credits_to_revoke INTEGER NOT NULL DEFAULT 0 CHECK(credits_to_revoke >= 0);
ALTER TABLE payment_refunds ADD COLUMN actor_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE payment_refunds ADD COLUMN reviewer_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE payment_refunds ADD COLUMN reason_category TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE payment_refunds ADD COLUMN credit_adjustment_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(credit_adjustment_confirmed IN (0,1));
UPDATE payment_refunds SET base_amount_fen=amount_fen,service_fee_amount_fen=0,credits_to_revoke=credits_reserved;
