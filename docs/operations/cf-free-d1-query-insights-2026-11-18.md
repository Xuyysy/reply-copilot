# CF Free D1 query insights & entitlement history page optimization

Date: 2026-11-18. Source baseline `a4de6d7a796f022e0f9710d1667eb5c761153c8f` on `release/production`.

## Real query-level Cloudflare evidence (Analytics API only)
Cloudflare GraphQL `d1QueriesAdaptiveGroups`, complete 2026-11-17 UTC day, sorted by `sum_rowsRead_DESC`. These are observed historic **Production query signatures**, not current deployed-version validation, and the dataset can be sampled.

| Query signature (not bound values) | Executions | Rows read |
|---|---:|---:|
| Admin filtered user directory with correlated all-history activity/generation subqueries | 10 | 12,485,540 |
| ACK-proven monthly generation totals | 97 | 1,438,675 |
| All-history credit ledger aggregate | 80 | 1,055,406 |
| Admin unified entitlement activity UNION across historical sources | 10 | 595,871 |
| Subscription cost/usage admin statistics | 21 | 473,340 |

The leading 12.49M-row directory query has **already** been replaced by a bounded `ADMIN_USER_DIRECTORY_SELECT` in current release source; its presence in Nov 17 Production analytics is because that release was not yet deployed, NOT an excuse to rewrite or claim to have fixed it a second time. Similarly, PR #189 already made the historical ledger aggregate opt-in. A protected staging-first deployment of accumulated, tested release changes is the fastest material improvement, but this batch does **not** deploy.

## This batch: a second identifiable D1 problem
The administrator's `GET /v1/admin/entitlement-activity` used one `WITH changes AS (credit_ledger UNION ALL subscription_usage_events UNION ALL subscription_orders ...)` query. Even 50 requested rows could require extensive cross-source work within a 30-day window; selecting `source=subscription` could still involve the permanent-credit history.

Now each source executes at most one query, with:
- Date, authenticated user ID/exact email, source and binary (timestamp, prefixed ID) keyset cursor predicates pushed into that source BEFORE `ORDER BY ... LIMIT 51`.
- Credit-only view reads only credit ledger; subscription-only view reads only three subscription sources.
- Maximum 51 candidates per source and a stable, binary descending global merge to 50 items. Four branch ceilings are sufficient to produce the exact global top 51, including identical timestamps and changing source distribution.
- Original event types, refund-state audit, 'reserve' exclusion, user join, 30/366-day date validation, admin authorization and response shape remain unchanged.
- No D1 schema migrations or remote D1 SQL. No account or financial record writes.

## Verification and release gate
Local SQLite functional tests cover sources, exact email, authorization, stable ties/keysets; isolated workerd D1 performance test inserts 12,000 synthetic credit ledger rows and verifies subscription-only never touches the credit ledger, and the first two free-source pages each read bounded rows. Those measures are isolated component evidence, not production-wide savings.

Full exact-SHA PR and Push CI + Production Build are mandatory. Staging first; Production only through separate owner-authorized protected deployment. Do not mark CF Free ready until a full post-deployment UTC day meets the account D1 limit, write/CPU limits, storage and auth compatibility. Production/staging remote D1 SQL remains prohibited (including SELECT and PRAGMA).
