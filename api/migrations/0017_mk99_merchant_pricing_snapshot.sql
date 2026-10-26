-- New orders only. NULL means no merchant-cost estimate was recorded.
-- Never backfill financial history or overwrite actual platform fees.
ALTER TABLE payment_transactions ADD COLUMN merchant_pricing_snapshot TEXT;
