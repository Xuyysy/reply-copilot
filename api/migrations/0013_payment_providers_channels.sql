-- Additive payment routing snapshot. Existing orders keep their protocol and
-- receive a NULL channel because their historical channel cannot be inferred.
ALTER TABLE payment_transactions ADD COLUMN payment_channel TEXT
  CHECK(payment_channel IS NULL OR payment_channel IN ('ALIPAY_H5','WECHAT_H5'));

-- Operator defaults for new sales only. Insert missing keys without touching
-- purchase_enabled or any existing operational configuration.
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_rsa2_enabled','1',CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_rsa2_enabled');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_epay_enabled','0',CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_epay_enabled');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_alipay_enabled','1',CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_alipay_enabled');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_wechat_enabled','0',CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_wechat_enabled');
-- Platform release has no official read API. These remain closed until the
-- operator separately confirms the merchant-side channel/trade-scope release.
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_alipay_released','0',CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_alipay_released');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_wechat_released','0',CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_wechat_released');
