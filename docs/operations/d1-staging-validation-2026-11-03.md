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

## Seven-index recommendation (provisional)

Prioritize `ai_requests_user_created_idx`, `ai_requests_status_completed_idx`, `ai_usage_costs_created_idx`, and `credit_ledger_created_idx` for growing usage history. Date-leading order/audit/user indexes improve bounded admin lists but currently tiny tables have little measurable benefit. Each index adds write/storage cost (requests gain two). Retain all seven for authorized Staging evaluation; do not conclude Production needs all seven without workload evidence. Local workerd comparisons are in the separate performance report and are not remote measurements.
