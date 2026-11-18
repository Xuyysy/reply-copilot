// Read-only historical ledger totals. Keep exactly the existing historical
// bookkeeping semantics and expose SQL to synthetic local D1 cost tests.
// Never run this entire-history scan for the collapsed overview panel.
export const ADMIN_HISTORY_LEDGER_SQL = `SELECT COALESCE(-SUM(CASE WHEN kind='generation_debit' THEN paid_delta ELSE 0 END),0) paidCreditsSpent,
    COALESCE(SUM(CASE WHEN free_delta>0 THEN free_delta ELSE 0 END+CASE WHEN paid_delta>0 THEN paid_delta ELSE 0 END),0) totalIssued,
    COALESCE(-SUM(CASE WHEN kind='generation_debit' THEN free_delta+paid_delta ELSE 0 END),0) totalUsed FROM credit_ledger`;
