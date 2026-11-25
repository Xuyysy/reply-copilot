# Private password verifier release candidate — not approved for deployment

## Scope

Based on the actual deployed Production source plus verified local hot-path optimization. The private owner is a separate SQLite Durable Object Worker; its only HTTP response is 404. Candidate config deliberately has no routes, workers.dev, preview URLs, D1, payments, triggers, account ID, environment secrets or deployed API binding. Never deploy this candidate name to a live account. Only an explicitly authorized subsequent release may create environment-specific private names and binding overlays. No cloud credentials in test jobs.

- Existing API `PASSWORD_VERIFY_DO_ENABLED` stays off by default. No change to live Wrangler config, account plan, creation iterations, stored format or migrations.
- 10k/60k/100k use original native verification/creation. 210k verification uses pinned RustCrypto WASM only. No automatic rehash, retry or local fallback when RPC fails. The existing login/reset handlers own session issuance, rate limits, account state and reset challenge consumption.
- Material is UTF-8 password + NUL + unchanged environment pepper. RFC 2104 long-HMAC-key normalization handles >1024 bytes via SHA-256 prehash, mathematically equivalent for SHA-256 HMAC; shorter material follows the exact synthetic pilot path. The WASM has no imports. Fresh instance per verify; explicit buffer cleanup only, no claim of complete memory zeroization.
- Exact binary SHA256 2d34ed3d829ebff018cf3afaba063c9cfd90d14b00db938d082fa862e74ce838; Cargo.lock SHA256 09a6085dc9e2becfde66d4c013a8f5b2423800513ca8b3af6a6e37f6e632ccc3. Source and dependencies in ../cf-free-rustcrypto-wasm. Need release license notices and advisory review before distribution.

## Future rollout gates (all require separate approval)

1. Finish exact candidate full CI; verify reproducible artifact, dependency advisories and complete license notices, malformed/Unicode boundary tests, actual local API→private DO login/reset, creation parity, no public ingress, binding allowlist, no logging of credential material.
2. Separate staging owner and binding from production. Same staging pepper loaded through existing secure operational channel, never printed or copied to Git/Notion. Confirm source and destination independently and that both API and DO use the same secret without revealing it. Keep Paid while exercising switch and rollback; never use live customer hashes as test fixtures. Do not enable lower creation factors merely to pass Free.
3. Cloud end-to-end isolated synthetic CPU test requires independent authorization for a dedicated synthetic D1; current prohibition on remote D1 SQL remains. Obtain request-level HTTP CPU coverage for login/register/reset, generate/replay/ACK, account/admin/cron. Project engineering limit max<=8ms and P95<=5ms for HTTP (not official limits); measure DO separately. Missing sample is not zero. Verify complete UTC day account-wide request, D1, DO request/duration/storage quotas. Check actual plan and rollback readiness independently.
4. Paid rollback: turn off DO flag on known-good API version and verify native auth while still on Paid; revert only candidate flags/versions. Do not delete a namespace or change pepper until no binding needs it. SQL index proposal rollback requires separately approved migration; never run against remote D1 in current task. Free rollback must restore Paid first if old native 210k cannot run under Free, otherwise fail closed; don't claim instantaneous rollback.

Current decision: NO_GO. Nothing deployed; no production or staging changes.
