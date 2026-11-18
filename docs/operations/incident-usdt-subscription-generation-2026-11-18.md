# Emergency subscription spend hotfix — 2026-11-18

**Incident:** a paid, applied USDT/BEP20 BASIC subscription was visible as active to `subscriptionAccount` but the atomic generation reservation still required fiat `subscription_payment_transactions`. The end user could therefore see an active plan but receive 402 from `reserveGeneration` after paid/free credits were exhausted.

## Code change
- Keep exact existing local-mock/MK99/Xiaodou proof as `FIAT_PROOF_SQL`.
- Add a separately guarded BoltUtil `CRYPTO_PROOF_SQL` to the **atomic** `INSERT INTO ai_requests ... SELECT` predicate. It requires the same settled order, applied time, matching bound user, token amounts, network/hash match, receipt body SHA256, and confirmed period as the existing account eligibility check.
- Touch BoltUtil SQL **only** if `ENVIRONMENT` is staging/production **and** `BOLTUTIL_SCHEMA_READY='1'`; other environments remain fiat-only and do not query missing crypto tables.
- No manual credit grants, fictitious fiat transaction, financial record mutation, or subscription extensions.
- Add local SQLite end-to-end reservation/ACK regression with zero permanent/free credits, failed unverified payment, matching BEP20 verified receipt, successful once-only ACK, then payment-event removal denial; add schema-disable, held, underpaid and frozen-user cases.

## Release safety
No remote D1 SQL or production writes in this PR. Run exact-SHA Push/PR CI, full API test suite and Production Build. Production must be updated through owner-reviewed guarded deployment; take care to retain independently configured **1 USDT = CNY 6.67** rate (both Production bindings set to `6670000`) and all 54 remaining bindings. The Cloudflare Free project is unrelated and must not weaken payment proof. Perform an authenticated customer test after deployment.
