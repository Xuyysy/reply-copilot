# CF Free batch — lazy historical admin metrics and verified 3-day baseline

Date: 2026-11-18; source baseline `237f40a89a2d8a8110bc7d866d84663b0d5f6d18` on `release/production`.

## Independently read-only Cloudflare baseline (complete UTC days)
The Cloudflare Analytics GraphQL aggregate (not remote D1 SQL) was read for the whole account:

| UTC date | Workers invocations | D1 rows read (account) | D1 rows written (account) | observed max Worker CPU |
|---|---:|---:|---:|---:|
| 2026-11-15 | 9,539 | 41,504,353 | 38,473 | 43.421 ms |
| 2026-11-16 | 7,268 | 28,201,000 | 29,722 | 50.156 ms |
| 2026-11-17 | 11,187 | 17,124,256 | 54,114 | 58.945 ms |

Production D1 accounts for 17,005,512 of 17-Nov rows. The decrease across dates is real aggregate usage, **not attributable to any single PR**: versions, operations and request mix differ. All days remain above Free's 5M/day account D1 read limit. Worker CPU tails exceeded the 10ms per HTTP invocation threshold; sampled maxima cannot identify a particular route. CPU profiling of the previously active version returned a Cloudflare 10393 “No recent executions were found” response; no profile was available.

## Code change (no schema, financial or deployment changes)
Previously the regular admin landing request `GET /v1/admin/dashboard?view=overview` ran `adminHistoricalStats` every time its 30s per-isolate cache expired. Those full-history `users`, `credit_grants`, `credit_ledger` and historical `recharge_orders` aggregates remain nonrealtime, and the historical panel on the frontend was already collapsed by default.

- `view=overview`: skip all those optional lifetime aggregates; provide the required `newUsers7d` from existing `users_created_id_idx` plus fresh generation, budget, monthly receipts and recent ops metrics.
- `view=history`: authenticated, optional exact original aggregates, requested only when the operator expands the history panel; explicit loading/failed state instead of misleading zeroes. Does not invoke monthly model-cost analytics.
- `view=cost`: opening AI model costs does not also trigger the unrelated lifetime historical scans.
- No view: preserve the legacy complete dashboard response and 30-second aggregate cache for existing API consumers.
- Existing finance, payment proof, mutation, role authorization, quota, login and business logic unchanged.

## Validation
- Local SQLite admin fixture tests assert overview/cost skip the expensive SQL and retain operational data, explicit history and full legacy API retain values, and unauthorized history is denied.
- Isolated Miniflare D1 inserts 12,000 synthetic ledger entries. The exact historical ledger aggregate demonstrably reads the ledger; default overview does zero such reads. This is **component-level structural avoidance**, not a measured estimate of total account or Production savings.
- Frontend regression tests check controlled lazy loading, stale request cancellation and no false zero for unloaded history. Full CI and production build must pass at exact SHA.
- Staging first. No Production or Staging D1 SQL, no Cloudflare config update, no password-flag change, payment/provider operation or live Worker deployment. Free stays NO-GO pending full postrelease UTC-day metrics and route-level CPU evidence.
