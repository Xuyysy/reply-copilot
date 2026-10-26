-- 0014 copied a provider-agnostic release flag into both Alipay interfaces.
-- The legacy flag does not prove approval for either specific protocol.
-- Keep 0014 immutable and revoke only its unaudited, automatically seeded
-- confirmations. Admin saves always populate updated_by; retain those values,
-- timestamps and audit records without replaying or resetting any settings.
UPDATE system_settings
SET value='0',updated_at=CAST(strftime('%s','now') AS INTEGER)*1000
WHERE key IN ('payment_rsa2_alipay_released','payment_epay_alipay_released')
  AND value='1' AND updated_by IS NULL;
