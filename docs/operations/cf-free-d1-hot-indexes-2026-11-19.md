# CF Free — source-only index candidates for observed D1 hotspots (2026-11-19)

The SQL in `api/sql-proposals/0032_cf_free_hot_query_indexes.sql` is **NOT a migration**. Do not execute it on any remote D1, backup, Staging, or Production without a new explicit authorization and budget check.

## Evidence

Cloudflare Production D1 Query Insights for complete UTC 2026-11-18:
- Per-user exact ACK-proven AI generation count: 14 executions, **236,694 rows read**.
- Bounded subscription usage-event history branch: 6 executions, **131,142 rows read**.
- Complete Production D1 database 2026-11-18: 1,506,748 rows read, 32,446 rows written. These sampled per-statement estimates may not sum to account totals.
- On partial UTC 2026-11-19, these two queries are **not** in the leading 28 by read volume, so they are a historical hotspot / cost-at-scale candidate, not proof of an ongoing incident.

## Proposed indexes

1. A **user-leading partial delivered-count index** on `ai_requests(user_id,status,consumed,delivery_confirmed_at)` restricted to exact ACK-proven success. Existing global `ai_requests_delivered_at_idx(status,delivery_confirmed_at)` cannot efficiently bound counts by a user; the existing `(user_id,status,created_at)` index still examines non-delivered matches.
2. A **date-leading partial event index** on `subscription_usage_events(created_at DESC,id DESC)` excluding reserve events. Existing `(period_id,day_index,created_at)` index cannot satisfy the global chronological event list without a period filter.

Both are additive and leave the business queries and all money/entitlement semantics unmodified. The new indexes add write amplification to delivered AI and subscription event insertions; quantify this against the account-wide 100,000 D1 rows written per UTC day before any release.

## Offline validation

Run `node --test api/tests/cf-free-hot-indexes.test.mjs` on Node 24. The test creates **only in-memory synthetic SQLite tables**, checks before/after exact count and event page equality, and validates that SQLite EXPLAIN QUERY PLAN chooses each new index (including the elimination of the event full-table scan). This is **not** actual D1 rows_read measurement or full finance/ledger regression.

## Release gate

Before applying anywhere: check full live `sqlite_master` index inventory through an approved read-only D1 window; use an isolated local/authorized staging D1 with realistic distributions to compare query metrics and writes; separately approve backup / remote CREATE INDEX; validate 24h D1 budgets and Worker CPU. Never run this source-only proposal automatically from CI or production build. Cloudflare Free remains NO-GO.
