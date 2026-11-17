# CF Free readiness — measured Production bottleneck and admin directory fix (2026-11-17)

## Scope and safety

This change fixes the **dominant D1 read hotspot** identified using Cloudflare GraphQL Analytics (read-only account telemetry, **not** a Production/Staging/replica D1 SQL query). **No remote D1 SQL, D1 migration, old database restore, payment, refunds, subscription or credit changes** are permitted or performed.

## Live baseline (Cloudflare GraphQL, UTC)

Production D1 database is identified via the existing Worker D1 binding, *not* by executing SQL. API: `viewer.accounts.d1AnalyticsAdaptiveGroups`, and `workersInvocationsAdaptive` from Account Analytics. Telemetry is aggregated/adaptive: per-query attribution can differ from daily summed D1 metrics, so do not naively add separately sampled metrics.

| UTC date | Production D1 rows read | Free daily cap | Production Worker requests | Worker CPU P95 |
|---|---:|---:|---:|---:|
| 2026-11-11 | 9,546,586 | 5,000,000 | 4,780 | 17.409 ms |
| 2026-11-12 | 37,839,053 | 5,000,000 | 13,392 | 14.965 ms |
| 2026-11-13 | 37,372,260 | 5,000,000 | 8,611 | 16.347 ms |
| 2026-11-14 | 35,226,115 | 5,000,000 | 7,800 | 15.733 ms |
| 2026-11-15 | 40,966,946 | 5,000,000 | 7,593 | 14.972 ms |
| 2026-11-16 | 27,752,767 | 5,000,000 | 5,444 | 11.343 ms |
| 2026-11-17 | 13,707,262 (partial UTC day) | 5,000,000 | 2,114 (partial) | 14.730 ms |

**Decision: NO-GO for Workers Free.** D1 5M/day and per-invocation 10ms CPU both fail. The observed Worker requests are comfortably below the account-wide 100k/day quota, though the latter also includes Staging and all other Workers.

### Culprit confirmed from read-only D1 query analytics

`d1QueriesAdaptiveGroups` identifies `api/src/admin-reporting.ts`'s `filteredUsers` SQL as the highest read-consuming query shape: approximately **1.15–1.20 million rows read per invocation** in sampled Nov 15–16 analytics, around **56–59 reported invocations/day** for this SQL variant (sampled/estimated, so these totals can differ from D1 daily aggregates). The expensive SQL computes `last_active_at` using four correlated aggregates and `generations` via a lifetime count per user on every ordinary dashboard load. It may be executed simply because the administrator refreshes the dashboard, even without opening the user management section.

Other read-heavy queries exist (admin AI costs, historical ledgers), but this one is the dominant immediate target. Optimization of the AI cost report was released in the previous batch and is not a substitute for removing the directory hotspot.

## Implemented: fast directory + on-demand exact detail

- `GET /v1/admin/users` **retains the exact filtered identities, ordering, role/status, signup metadata and credit balances**, limited to 200 users. Replaces expensive per-row lifetime `generations` and multi-table `last_active_at` with explicit `null` markers; returns `perUserStats:'detail_only'` so no caller can mistake omitted statistics for zero.
- The administrator UI explicitly displays **“详情查看准确次数 / Open details for exact count”**, not a fabricated zero, and indicates last-activity information belongs in detail.
- `GET /v1/admin/users/:id` performs the full original last-activity computation for **one selected user** and returns the **same exact ACK-confirmed generation count** as before, excluding pending, unconfirmed and unconsumed requests.
- These reads remain admin-session protected. No account ownership, CSV export, paid/unpaid filter, session, billing, funds, grants, webhook, request ACK, or entitlement logic changes.
- Tests verify request filters, money snapshots, list order, omission semantics, real user-detail count, and isolated synthetic workerd `rows_read`. The old expensive SQL is restricted to the local performance test and never shipped to Production.

## Acceptance / safe deployment

1. PR CI and Push CI green; Production release branch full CI and immutable Production Build successful.
2. Use **protected Worker-only** release with exact source SHA, expected live Worker version and separate Cloudflare binding/Secret/D1 postflight verification. **Do not deploy via direct API, or execute any remote SQL.** No Pages-only change unless the admin UI needs refreshed static assets; if so deploy **Worker first, Pages second** from the same immutable artifact.
3. Immediately confirm production Worker version, 56 existing bindings, payment secrets, five USDT networks, CNY/USDT rate, DB binding and `PASSWORD_FREE_CPU_ENABLED` state. Payments fail closed if any changes.
4. Compare fresh GraphQL **new Worker version** analytics to the previous complete UTC days. Ignore the mixed deployment day for before/after comparisons; the database-level metric includes Staging and external readers only if sharing a database.
5. **Do not downgrade yet** unless a complete post-deploy UTC day stays below 5M reads with substantial margin (target <=3M), D1 writes <=100k, account-wide requests <=100k, and all critical password/payment routes stay strictly within the 10ms Free CPU limit. Cloudflare CPU P95 alone is not sufficient because 10ms is a *per-request* cap; inspect tail and legacy 210k password behavior. If infeasible, keep Workers Paid.
6. Rollback via protected Worker+Pages release with zero D1 restore. Admin frontend is compatible with older API returning numeric generation totals; a frontend using new list API displays per-user stats only in detail.
7. The previously added opt-in `PASSWORD_FREE_CPU_ENABLED` remains OFF until separately enabled after a compatibility and rollback review. Lowering password rounds does not fix D1 scans or legacy 210k password verification.

## Data source

Cloudflare D1 metrics docs: https://developers.cloudflare.com/d1/observability/metrics-analytics/

Workers Free and D1 pricing: https://developers.cloudflare.com/workers/platform/pricing/ and https://developers.cloudflare.com/d1/platform/pricing/

Previous CF Free candidate: `docs/operations/cf-free-performance-batch-2026-11-17.md`.

**User-visible correctness constraint:** The list intentionally ceases to claim that it has already computed expensive lifetime statistics; the administrator may retrieve the exact total by opening one user's existing detail panel. This is a deliberate Free-tier tradeoff, not a missing-value bug.
