-- Split provider/channel operation and platform-release gates without
-- overwriting any existing operator setting. Legacy values are copied once;
-- the old keys remain for compatibility with older administrative clients.
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_rsa2_alipay_enabled',COALESCE((SELECT value FROM system_settings WHERE key='payment_alipay_enabled'),'1'),CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_rsa2_alipay_enabled');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_rsa2_wechat_enabled',COALESCE((SELECT value FROM system_settings WHERE key='payment_wechat_enabled'),'0'),CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_rsa2_wechat_enabled');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_epay_alipay_enabled',COALESCE((SELECT value FROM system_settings WHERE key='payment_alipay_enabled'),'1'),CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_epay_alipay_enabled');

INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_rsa2_alipay_released',COALESCE((SELECT value FROM system_settings WHERE key='payment_alipay_released'),'0'),CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_rsa2_alipay_released');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_rsa2_wechat_released',COALESCE((SELECT value FROM system_settings WHERE key='payment_wechat_released'),'0'),CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_rsa2_wechat_released');
INSERT INTO system_settings(key,value,updated_at)
SELECT 'payment_epay_alipay_released',COALESCE((SELECT value FROM system_settings WHERE key='payment_alipay_released'),'0'),CAST(strftime('%s','now') AS INTEGER)*1000
WHERE NOT EXISTS(SELECT 1 FROM system_settings WHERE key='payment_epay_alipay_released');
