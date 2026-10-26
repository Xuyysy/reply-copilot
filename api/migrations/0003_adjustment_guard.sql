-- Guard manual adjustments across concurrent requests without rewriting balances.
ALTER TABLE credit_accounts ADD COLUMN last_adjustment_ref TEXT;
