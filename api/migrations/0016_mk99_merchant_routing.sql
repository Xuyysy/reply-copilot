-- Additive identity: legacy provider/protocol CHECKs remain intact. They are
-- historical storage namespaces, never the authoritative merchant selector for
-- MK99 rows. merchant_provider is the immutable routing/verification identity.
ALTER TABLE payment_transactions ADD COLUMN merchant_provider TEXT NOT NULL DEFAULT 'xiaodou' CHECK(merchant_provider IN ('xiaodou','mk99','local_mock'));
UPDATE payment_transactions SET merchant_provider='local_mock' WHERE provider='local_mock';
ALTER TABLE payment_transactions ADD COLUMN merchant_account TEXT;
ALTER TABLE payment_transactions ADD COLUMN notification_sign_type TEXT;
ALTER TABLE payment_transactions ADD COLUMN provider_payment_id TEXT;
ALTER TABLE payment_transactions ADD COLUMN provider_requested_fen INTEGER CHECK(provider_requested_fen IS NULL OR provider_requested_fen>0);
ALTER TABLE payment_transactions ADD COLUMN actual_paid_fen INTEGER CHECK(actual_paid_fen IS NULL OR actual_paid_fen>0);
ALTER TABLE payment_transactions ADD COLUMN merchant_settlement_fen INTEGER CHECK(merchant_settlement_fen IS NULL OR merchant_settlement_fen>=0);
ALTER TABLE payment_transactions ADD COLUMN provider_service_fee_fen INTEGER CHECK(provider_service_fee_fen IS NULL OR provider_service_fee_fen>=0);
ALTER TABLE payment_transactions ADD COLUMN amount_contract TEXT;
ALTER TABLE payment_transactions ADD COLUMN risk_state TEXT NOT NULL DEFAULT 'clear';
CREATE UNIQUE INDEX payment_merchant_trade_uq ON payment_transactions(merchant_provider,provider_payment_id) WHERE provider_payment_id IS NOT NULL;
ALTER TABLE provider_payment_events ADD COLUMN merchant_provider TEXT NOT NULL DEFAULT 'xiaodou';
UPDATE provider_payment_events SET merchant_provider='local_mock' WHERE provider='local_mock';
CREATE TABLE mk99_risk_events(
 id TEXT PRIMARY KEY,
 transaction_id TEXT NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
 source TEXT NOT NULL CHECK(source IN ('notification','query')),
 trade_status TEXT NOT NULL CHECK(trade_status IN ('TRADE_REFUND','TRADE_FREEZE','TRADE_UNFREEZE')),
 event_timestamp INTEGER NOT NULL,
 body_sha256 TEXT NOT NULL,
 received_at INTEGER NOT NULL
);
-- Preserve existing sales behavior; no automatic provider switch or approval.
INSERT INTO system_settings(key,value,updated_at) SELECT 'active_merchant','xiaodou',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='active_merchant');
INSERT INTO system_settings(key,value,updated_at) SELECT 'payment_mk99_enabled','0',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_mk99_enabled');
INSERT INTO system_settings(key,value,updated_at) SELECT 'payment_mk99_alipay_enabled','0',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_mk99_alipay_enabled');
INSERT INTO system_settings(key,value,updated_at) SELECT 'payment_mk99_wechat_enabled','0',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_mk99_wechat_enabled');
INSERT INTO system_settings(key,value,updated_at) SELECT 'payment_mk99_alipay_released','0',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_mk99_alipay_released');
INSERT INTO system_settings(key,value,updated_at) SELECT 'payment_mk99_wechat_released','0',CAST(strftime('%s','now') AS INTEGER)*1000 WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_mk99_wechat_released');
