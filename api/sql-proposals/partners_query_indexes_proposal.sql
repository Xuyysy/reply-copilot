-- Source-only performance candidate. Apply ONLY after actual migration stack
-- and partner proposals in an isolated database. Never automatically migrate.
-- Existing indexes may overlap; assess actual query plans and write cost before
-- approval. No changes to payment callback logic.
CREATE INDEX IF NOT EXISTS partner_discovery_recharge_applied_idx ON recharge_orders(credited_at,id) WHERE credited_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_discovery_subscription_applied_idx ON subscription_orders(applied_at,id) WHERE applied_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS partner_recharge_provider_trade_idx ON payment_transactions(merchant_provider,provider_trade_id);
CREATE INDEX IF NOT EXISTS partner_recharge_provider_payment_idx ON payment_transactions(merchant_provider,provider_payment_id);
CREATE INDEX IF NOT EXISTS partner_subscription_provider_trade_idx ON subscription_payment_transactions(merchant_provider,provider_trade_id);
CREATE INDEX IF NOT EXISTS partner_subscription_provider_payment_idx ON subscription_payment_transactions(merchant_provider,provider_payment_id);
CREATE INDEX IF NOT EXISTS partner_recharge_proof_idx ON provider_payment_events(transaction_id,merchant_provider,event_type,amount_fen,currency);
CREATE INDEX IF NOT EXISTS partner_subscription_proof_idx ON subscription_payment_events(transaction_id,merchant_provider,event_type,amount_fen);
CREATE INDEX IF NOT EXISTS partner_refund_proof_idx ON payment_refunds(transaction_id,status,base_amount_fen);
CREATE INDEX IF NOT EXISTS partner_credit_proof_idx ON credit_batches(source_order_id,user_id,source_kind,grant_credits);
CREATE INDEX IF NOT EXISTS partner_ledger_fifo_idx ON partner_commissions(partner_user_id,paid_at,order_domain,order_id);
