-- Preserve every old order as RSA2. Epay uses the same provider/credit ledger,
-- with an immutable protocol and merchant snapshot for callback isolation.
ALTER TABLE payment_transactions ADD COLUMN payment_protocol TEXT NOT NULL DEFAULT 'rsa2'
  CHECK(payment_protocol IN ('rsa2','epay'));
ALTER TABLE payment_transactions ADD COLUMN epay_pid TEXT;
ALTER TABLE payment_transactions ADD COLUMN epay_trade_no TEXT;
CREATE UNIQUE INDEX payment_transactions_epay_trade_idx ON payment_transactions(epay_trade_no)
  WHERE epay_trade_no IS NOT NULL;
