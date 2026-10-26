-- Read-only summaries. No user identifiers, provider credentials or payment links.
SELECT 'paid_orders_without_exact_grant' AS check_name,COUNT(*) AS anomalies
FROM recharge_orders o JOIN payment_transactions t ON t.order_id=o.id
WHERE t.status='paid' AND (
 o.status!='paid' OR o.credited_at IS NULL
 OR (SELECT COUNT(*) FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id)!=1
 OR (SELECT COALESCE(SUM(l.paid_delta),0) FROM credit_ledger l WHERE l.kind='purchase_grant' AND l.reference_id=o.id)!=o.credits
 OR (SELECT COUNT(*) FROM credit_batches b WHERE b.source_order_id=o.id)!=1
 OR (SELECT COALESCE(SUM(b.grant_credits),0) FROM credit_batches b WHERE b.source_order_id=o.id)!=o.credits
);
SELECT 'account_batch_balance_mismatch' AS check_name,COUNT(*) AS anomalies
FROM credit_accounts a WHERE
 a.free_balance!=(SELECT COALESCE(SUM(b.remaining_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='free') OR
 a.paid_balance!=(SELECT COALESCE(SUM(b.remaining_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid') OR
 a.free_generation_reserved!=(SELECT COALESCE(SUM(b.generation_reserved_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='free') OR
 a.paid_generation_reserved!=(SELECT COALESCE(SUM(b.generation_reserved_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid') OR
 a.paid_reserved_for_refunds!=(SELECT COALESCE(SUM(b.refund_reserved_credits),0) FROM credit_batches b WHERE b.user_id=a.user_id AND b.bucket='paid');
SELECT 'invalid_credit_batches' AS check_name,COUNT(*) AS anomalies FROM credit_batches
WHERE remaining_credits<0 OR consumed_credits<0 OR generation_reserved_credits<0 OR refund_reserved_credits<0
 OR generation_reserved_credits+refund_reserved_credits>remaining_credits
 OR grant_credits!=remaining_credits+consumed_credits+permanently_revoked_credits;
SELECT 'paid_epay_without_platform_reference' AS check_name,COUNT(*) AS anomalies FROM payment_transactions
WHERE payment_protocol='epay' AND status='paid' AND (epay_trade_no IS NULL OR length(epay_trade_no)=0);
