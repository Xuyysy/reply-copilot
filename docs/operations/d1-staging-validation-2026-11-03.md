# PR10 Staging validation — 2026-11-03

Scope: Staging only. PR10 remains Draft; no Production, Pages or extension deployment.

## Baseline and isolation

- Staging source `258c6b2280bf8634f9d2e20328166e57818d6c89`; all 43 deployed source-map files matched SHA-256.
- Worker version `0e20ea94-55ce-4c61-9da8-acfd8d7e6761`, deployment `4f3f0b19-2d03-4e93-951c-d7a4d14e3d23` at 100%.
- Applied PR10's API-only diff to this Staging baseline, preserving Staging's model-test policy and accepted prompt. No web code copied from Production.
- Exact live public variables, 42 binding descriptors, compatibility flags and observability captured privately. Secrets were neither read nor exported. Cron remains `0 3 * * *`.

## Backup / rehearsal

- Private backup: `~/.codex/backups/reply-copilot/d1-efficiency-staging-20261103/staging-before.sql` (directory 0700, file 0600).
- SHA-256 `229cb5ec41a194c0a0ca1f0ec77c85a94833b15aa67ebdbafb9fc2d0bc27ec86`.
- Restored into isolated local SQLite: 50 tables; integrity `ok`, zero foreign-key violations. All existing rows compared exactly before/after seven additive indexes. No migration of financial data.
- All seven representative query plans use their intended indexes on the restored database. Index removal/reapplication and migration-record insertion rehearsed only locally.
- Database allocation grew 3,014,656 → 3,166,208 bytes locally. Real-world read/write benefits still require observation.

## Verification

- Full Staging suite: 723/723 passed. First run: 722/723, existing browser checkbox-selection test intermittently failed; isolated rerun and unchanged full rerun passed. No frontend code/test weakened.
- API and Web TypeScript passed; exact-live-config Worker dry-run passed.
- Staging-only `admin_history_cache` diagnostic gated by existing `AI_PERFORMANCE_DIAGNOSTICS=1`: anonymous isolate, hit/miss/failed, age and TTL only. No identities, content, request IDs or query parameters. New test failed before implementation and passed afterward.
- Public baseline: health/packages 200, unauthenticated dashboard 401.
- Cloudflare GraphQL (not D1 SQL), 2026-11-03 01:00–02:00 UTC: D1 rowsRead=776, rowsWritten=210, readQueries=144, writeQueries=104; 23 Worker requests, zero platform errors. This idle mixed-workload window is not a controlled before/after benchmark.

## Release and recovery gates

Only apply 0020 after verifying unchanged live Worker/bindings and migration head 0019. Upload candidate without traffic first; inspect all binding descriptors, then migrate and switch to 100%. Keep original version above available.

Rollback means redeploying the original Worker version at 100%; retain compatible additive indexes. Never restore this backup over new activity. Index removal requires a separate, measured decision; it is unnecessary for code rollback.

User will trigger legitimate authenticated Staging requests. Real login/signup/claim/AI/ACK, cache-hit proof and post-release Analytics remain pending until observed. No credentials will be extracted or authentication bypassed.

## Executed Staging release

- Deployed source `a95dcf9701567068a8d63e00790f720c110c67c0` on `staging/d1-query-efficiency-20261103`.
- Version `cf43598d-c470-4e66-ad06-5baa3cb633b4`; deployment `941419d8-3b7c-4d18-a07c-1b3b0881cada`, confirmed 100%.
- All 45 deployed source-map files subsequently matched the exact deployment commit. Upstream PR10 diagnostic commit `69c427474fe3d6b198f2902be7098d82d4e397eb` passed 728/728 full tests; the Staging-specific tree passed 723/723 (different existing model-test policy retained).
- Wrangler confirmed only 0020 pending, then applied it successfully (8 commands including tracking, 8.75 ms). Migration record and all seven indexes independently re-read.
- All 42 binding descriptors, public variables, compatibility, Cron and observability matched the original. Existing Secrets inherited without reading values. AI/purchase/admin/payment channels stay enabled; current live model preserved (no switching performed).
- Health/packages 200; unauthenticated dashboard 401; package JSON exactly unchanged.
- Production Worker stayed `bc36392d-cc33-4f75-9ca7-b7fb29baed02` at 100%. No Pages or extension deployment.
- Non-D1 GraphQL after deployment, 02:17–02:20 UTC: 42 D1 reads, zero writes, two read queries; eight Worker requests, zero platform errors. This is only a smoke-test/idle window, not a comparable performance improvement claim.
- Initial cache-log query found no matching events; authenticated dashboard requests had not yet been confirmed. Observability query `statistics.rows_read` refers to its analytics dataset, NOT D1 billing; do not confuse it with D1 GraphQL rowsRead.

### Manual trigger

Open the Staging admin overview; refresh three times about five seconds apart, wait 35 seconds, refresh again. Then use the existing Staging extension for one normal generation. Report completion/time or visible error, never credentials. Inspect `admin_history_cache` for same-isolate hits within TTL and fresh misses after TTL; inspect generation/ACK logs and bounded request-specific ledger records. Multi-isolate misses alone are not proof of a broken cache.

### Code rollback

Use Cloudflare version deployment for **Staging** only, with strategy `percentage` and versions `[{"version_id":"0e20ea94-55ce-4c61-9da8-acfd8d7e6761","percentage":100}]`. Recheck settings/health/packages afterwards. Keep 0020 and all subsequent data; no database restore or financial repair is part of rollback.

## User-triggered live acceptance — 2026-11-03, UTC+8

User personally triggered dashboard refreshes and real extension generations. Codex used read-only logs, non-D1 Analytics and bounded Staging point lookups; no browser/credentials/billable generation invocation by Codex.

### Real Worker cache

Four events from the same anonymous isolate (no identifiers retained here):

| Time | Status | Cache age |
|---|---|---:|
| 10:29:40.891 | miss | 0 ms |
| 10:30:01.820 | hit | 20,929 ms |
| 10:30:11.465 | miss | 30,574 ms |
| 10:31:00.879 | miss | 49,414 ms |

This proves cross-request reuse in a real Worker instance and expiration at 30 seconds. It does not prove a cache shared across isolates, which this implementation deliberately does not provide.

### Real generation / ACK / accounting

Two separate requests began at 10:31:17.884 and 10:31:32.235. The user confirmed intentionally generating twice or more; these are not evidence of a duplicate request from one click.

- Both `succeeded`, `consumed=1`, original result present and delivery confirmation recorded (10:31:22.098 / 10:31:34.991).
- Each has exactly one `generation_debit`, free_delta=0, paid_delta=-1; one consumed allocation of one credit and one usage-cost row.
- Tokens: 1,464 input / 138 output and 1,462 / 132; estimated costs 1,544 and 1,526 micro-USD respectively (combined $0.003070).
- The tested account matches free/paid batch balances, generation/refund reservations; all batch remaining=granted-consumed-revoked; no negative account values or invalid batches.
- Day budget at verification: settled 51,648 micro-USD, reserved 0, versus configured 5,000,000. This includes other day activity and is not attributed entirely to this test.
- No active ACK retry, replay, cancellation or registration was deliberately triggered here; these remain automated coverage, not live acceptance claims. Normal successful delivery was verified by persisted ACK, not inferred from UI text.

### Non-D1 Analytics

10:28–10:32 UTC+8 (02:28–02:32 UTC): 52 new-version Worker requests, zero platform errors; D1 238 reads, 38 writes, 18,244 rowsRead / 87 rowsWritten; average D1 query batch 0.471 ms. Mixed dashboard/auth/AI/ACK traffic and different baseline activity prevent a valid percentage read-reduction or latency-improvement claim. No old unbounded SQL executed remotely.

### Newly discovered pre-existing statistics defect

Successful ACKed requests have `delivery_confirmed_at` populated while `completed_at` remains NULL. `finishGeneration` and ACK paths already behaved this way in the original Staging source. Original and PR10 dashboard day/month counters both filter `status='succeeded' AND completed_at>=?`, so these real successes are omitted. This explained an initial empty verification lookup; subsequent cost-date-index lookup plus full-key request/ledger checks verified the requests correctly.

This is a pre-existing reporting issue, not lost credits or a new PR10 regression. No request history or financial logic was patched. Keep Production rollout unapproved until reporting semantics and regression coverage are resolved. In particular, do not claim the status/completed index makes modern-success statistics complete; it only preserves/optimizes the existing predicate. Reassess this index after that fix. Code rollback alone would retain the same defect.

Live login/new signup/new200 entitlement and deliberate ACK replay/cancellation still require separate controlled user acceptance if required for final release. Current verdict: cache + normal AI/ACK/accounting accepted; PR remains Draft, no Production release.

## Seven-index recommendation (provisional)

Prioritize `ai_requests_user_created_idx`, `ai_requests_status_completed_idx`, `ai_usage_costs_created_idx`, and `credit_ledger_created_idx` for growing usage history. Date-leading order/audit/user indexes improve bounded admin lists but currently tiny tables have little measurable benefit. Each index adds write/storage cost (requests gain two). Retain all seven for authorized Staging evaluation; do not conclude Production needs all seven without workload evidence. Local workerd comparisons are in the separate performance report and are not remote measurements.
