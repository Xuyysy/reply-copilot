-- Keep the provider's settlement projection separate from the customer-facing
-- principal/service-fee snapshot. Never infer provider settlement from a rate.
ALTER TABLE payment_transactions ADD COLUMN provider_fee_projection_status TEXT NOT NULL DEFAULT 'not_applicable'
  CHECK(provider_fee_projection_status IN ('not_applicable','pending','verified','review','legacy_unverified'));
ALTER TABLE payment_transactions ADD COLUMN provider_fee_projection_json TEXT;
ALTER TABLE payment_transactions ADD COLUMN provider_fee_projection_issue TEXT
  CHECK(provider_fee_projection_issue IS NULL OR provider_fee_projection_issue IN ('missing','invalid','conflict','legacy_unverified'));

-- Older Xiaodou rows have no trustworthy stored projection. Keep them usable,
-- but make their reconciliation status explicit until reviewed or refreshed.
UPDATE payment_transactions
SET provider_fee_projection_status='legacy_unverified',
    provider_fee_projection_issue='legacy_unverified'
WHERE provider='xiaodou';
