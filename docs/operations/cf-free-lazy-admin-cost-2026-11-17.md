# CF Free: administrator AI cost history on-demand (2026-11-17)

## Why this is required
Read-only Cloudflare GraphQL D1 Query Analytics (never a remote D1 SQL execution) previously measured the old `ai_usage_costs` month report at **~42,307 rows per invocation** (46 sampled occurrences on UTC 2026-11-15). After the much larger admin-user directory hotspot was fixed in PR #163, this unconditional monthly history scan became a meaningful remaining Free-tier read cost. Worker Free still has a 10ms CPU per-request limit; saving optional SQL reduces latency and D1 reads but does not certify every request.

Observed shortly after the 2026-11-17 Worker+Pages PR #163 release: the new version had only a handful of sampled requests. The older >1M-read admin directory query did not appear in the sampled postdeploy window, but no complete postrelease UTC day yet exists. **Current decision: NO-GO on Workers Free**, pending a complete verified daily read and CPU profile.

## Code change: opt into expensive exact report only from the cost workspace

- `GET /v1/admin/dashboard?view=overview`: authenticated summary with normal user, conversion, revenue, active session, AI delivery, and budget counters. **Does not execute the `COST_HISTORY_SQL` monthly join/aggregation, or active model metadata query**. Omits `cost`, `todayCost`, `costByModel`, and `aiService` entirely instead of returning fabricated zeros. Adds `detailScope:"overview"`.
- `GET /v1/admin/dashboard`: **backward-compatible complete endpoint** with exactly the same monthly/day model breakdown, active immutable provider version, credentials-present flag, and cost estimates as before. Adds `detailScope:"full"`. Does not return any plaintext API keys.
- The authoritative `ai_budget_days` reserved/settled values, budget limit, remaining budget, error counts, and circuit indicators stay current in both modes. Existing signed payments, subscriptions, credit allocations, refund safety, webhook replay and password verification **do not change**.
- `AdminDashboard` initially fetches summary only. When (and only when) the operator navigates to the AI Cost workspace, it requests the complete report, merges results without overwriting the other overview counts, and shows a loading state until the exact report arrives. Cancelled/hidden workspace requests may not overwrite newer UI state. Refresh invalidates the optional report.
- The prior per-isolate 30-second `adminHistoricalStats` cache remains unchanged. The directory change in PR #163 stays in place.

## Evidence and acceptance

- Regression: summary mode does not call any `FROM ai_usage_costs` query; legacy full mode retains true costs, pinned-version attribution and unchanged budget/circuit result; non-admin use remains rejected.
- Isolated workerd `meta.rows_read` benchmark with 2,500 synthetic cost rows measures exact cost query reads versus zero when omitted. This benchmark refers to the **optional model history segment only**, not the entire dashboard.
- CI, TS, tests and immutable production build must be green on exact `release/production` SHA before a protected release. Deploy Worker first and Pages second with version/Pages deployment compare-and-swap.
- Zero schema migrations, no remote D1 SQL, no changes to Worker bindings, Secrets or payment/USDT settings.
- Measure complete *post-deploy* UTC days via the already available Cloudflare GraphQL read-only `workersInvocationsAdaptive`, `d1AnalyticsAdaptiveGroups`, `d1QueriesAdaptiveGroups`, compare against predeploy days cautiously (adaptive sampling), and inspect CPU P95/P99/max plus D1 <5M/day; per-request CPU needs to stay below 10ms for all essential routes. Budget for growth (prefer <3M daily reads), not merely barely below the cap.

Historical Cloudflare production figures before the directory fix (UTC): Nov 15 40,966,946 D1 rows read, Worker CPU P95 14.972ms; Nov 16 27,752,767 rows, CPU P95 11.343ms. **Do not claim this optional report alone fixes either limit.**

Runbook: `docs/operations/cf-free-admin-user-list-read-hotspot-2026-11-17.md`. Official limits: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/workers/platform/limits/.
