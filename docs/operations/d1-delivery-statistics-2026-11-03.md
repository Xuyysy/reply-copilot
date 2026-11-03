# Confirmed delivery statistics correction — 2026-11-03

## Business definition and evidence

Dashboard `todayGenerations` / `monthGenerations` mean confirmed delivered requests, by UTC ACK time. Predicate: `status='succeeded'`, `consumed=1`, nonempty `delivery_confirmation_id`, and `delivery_confirmed_at` within month-start through current request time. Count each request row once. Today/month API field names remain unchanged; they are read fresh outside the 30-second historical-counter cache.

Current quota ACK writes delivery timestamps and the final ledger atomically but does not set `completed_at`. Pre-ACK historical quota code (e.g. b1611d9) set succeeded/completed on provider response and could debit on reservation; those fields alone do not prove delivery. 0008 marks legacy phases unknown and cannot recover ACK evidence. Therefore:

- Historical rows with real ACK timestamp and confirmation marker are counted identically, even if phase is unknown or completed_at is missing/different.
- Pre-ACK rows with only completed_at/status/consumption are **not** inferred to have been delivered. This deliberate evidence rule can lower older reported totals. No completion/create-time fallback can establish the required client confirmation or correct UTC date.
- Pending result, upstream failure, uncertain/expired/released and unconsumed rows are excluded. Future ACK timestamps are excluded.
- No quota/ACK/cleanup code change and no historical update/backfill. completed_at retains its provider/failure/cleanup meaning.
- Other uses reviewed: user-list lifetime figures use succeeded status or debit ledger (different historical totals); no other day/month succeeded-completed range was found. Admin model-test completed_at belongs to its separate test table and is unchanged.

## Isolated workerd measurements

Full pre-0020 schema with synthetic history; 0020 applied; 200 modern delivered rows inside this month, remaining history older, modern completed_at=NULL. One pre-ACK legacy row inside the month deliberately exposes incorrect old behavior.

| History | Old incorrect predicate reads/count | Correct without ACK index | Correct with 0021 |
|---:|---:|---:|---:|
| 2,000 + legacy row | 1 read / counts 1 wrongly | 2,001 reads / counts 200 | 200 reads / counts 200 |
| 20,000 + legacy row | 1 read / counts 1 wrongly | 20,001 reads / counts 200 | 200 reads / counts 200 |

Old plan: SEARCH covering status/completed index, completed_at range; cheap but wrong. Correct query before migration: SEARCH same index by status alone. After migration: SEARCH `ai_requests_delivered_at_idx (status=? AND delivery_confirmed_at>? AND delivery_confirmed_at<?)`. No unbounded query runs remotely.

An initial single-column ACK partial index lost planner preference to the existing status index in actual workerd; the final `(status,delivery_confirmed_at)` partial index fixes this without forcing INDEXED BY. Cost checks use actual D1 metadata, not Node SQLite estimates.

## Migration / write costs

0020 is immutable and already applied in Staging. New **0021_ai_delivery_statistics_index.sql** creates a partial status/ACK-time index containing only confirmed consumed successes, then drops the now-unused status/completed index. No tables, constraints or rows change. No remaining application query forces the removed index.

Measured reserve insert writes 8→7; ACK transition writes 4→4 (same runtime, atomic insert/ACK/delete probes). Index build wrote 2,001 / 20,001 rows in these all-delivered fixtures; DROP reported 0 row writes. Size after build/drop: 2,740,224 / 21,630,976 bytes. The new index excludes pending/failed rows; old index indexed every request. Exact live benefit depends on history/status distribution.

Replacing the index via 0021 is needed before serving the new time-range query at scale. Existing 0020-only code still executes if rolled back; it may lose its former range index and would retain the original reporting bug. Keep compatible additive schema on code rollback. Optional re-creation of `(status,completed_at)` can restore old-code performance without reverting data; never restore an old database over new activity. This optional DDL must target Staging only and be checked against current migration state.

## Regression and release gates

- Unit/integration: ACK success with NULL completed_at, historical ACK/no-ACK distinction, invalid marker/unconsumed/future data, pending/failed/expired, repeated ACK and one debit, UTC midnight/month crossing, fresh stats while historical cache remains warm.
- Miniflare/workerd: real plans/rows_read, equal correct counts before/after index, request-history preservation and reserve/ACK write costs.
- PR10 full suite: 732/732; API/Web types and exact Staging-config dry-run passed. Staging-specific full suite and deployment recorded separately.
- Production remains unauthorized; no Production database or configuration mutations, no Pages or extension changes, no paid model tests. Final live verification uses existing Staging ACK rows only.

Machine-readable synthetic evidence: `d1-delivery-stats-performance-2026-11-03.json`.
