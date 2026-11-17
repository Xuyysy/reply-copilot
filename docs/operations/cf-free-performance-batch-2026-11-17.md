# Cloudflare Free: D1 read + Worker CPU hardening (one-batch candidate, 2026-11-17)

## Decision and boundaries
This is an **offline, code-only candidate** for `release/production`, not an authorization to downgrade the Cloudflare plan, execute remote D1 SQL, or deploy Worker automatically. Current deployment, payment system, cryptographic keys, existing funds and D1 data are not modified by merging source. User approved modest password-cost tradeoffs to pursue Free; the tradeoff is deliberately explicit.

Cloudflare's documented Free limits on this date include **10 ms HTTP Worker CPU/invocation**, **100,000 Worker requests/day**, **5,000,000 D1 rows read/day**, and **100,000 D1 rows written/day**. These are different independent gates: cutting D1 reads does not guarantee CPU headroom and vice versa.

**Absolute guard:** no Production/Staging/copy D1 SQL, including SELECT, EXPLAIN, queries over snapshots, migrations, statistics or automated probes. All reproducible tests run against locally created synthetic fixtures. Read-only Cloudflare provider telemetry is acceptable; no billing/analytics privileges were available through the current connection, so this batch does *not* claim actual Free readiness.

## Implementation scope

### 1. AI cost report: cost rows grouped before metadata attribution
- New `api/src/ai-cost-queries.js` contains a **single** versioned SQL implementation for production and tests, from previously measured PR #11.
- Group `ai_usage_costs` by `provider_config_id`, `provider_config_version`, and `model` in the month window *before* joining immutable `ai_provider_config_versions`, then combine provider/model/source dimensions.
- Preserve legacy/mock, unresolved configs, pinned version identity, failed-provider estimated usage and UTC today/month boundaries. No budget reservation or settlement query is touched. The authoritative daily budget is always read separately.
- `api/tests/ai-cost-free-performance.test.mjs` compares old and new result rows **exactly** on mixed synthetic data and uses isolated workerd D1 `meta.rows_read` to assert non-regression; not a remote query.
- Historical 2026-11-03 PR #11 evidence (20k synthetic cost records): **54,007 → 40,015 rows read** (approximately 26% fewer). This is **historical evidence only**, not the current actual production traffic, and no other D1 endpoint gains 26% by implication.

### 2. Password derivation: measured tradeoff, not a bypass
- New password hashes and password resets use PBKDF2-HMAC-SHA256 with **60,000** rounds, 128-bit random salt, mandatory private pepper and 12-character minimum password (previously 100,000 rounds for new hashes).
- Existing **100,000 and 210,000** rounds remain fully supported for login and old-password verification. No existing hash is rewritten or skipped; no forced logout or account lockout. No weakening of current rate limits, verification-email flows, Turnstile registration, cookie security or transaction authorization.
- `api/tests/password-cf-free-compat.test.mjs` checks new, old and incorrect passwords, random salts, missing pepper, real route authentication and frozen-account behavior; local Node timing is *not Cloudflare billed CPU*.
- **Security cost:** 60k offers weaker protection against offline password guessing than 100k. A strong non-exported pepper helps if only the database leaks, but does not eliminate the risk of compromised pepper, weak user passwords or credential stuffing. This setting is *below contemporary high-strength PBKDF2 recommendations*. Do not claim it is equally secure.
- **Critical Free blocker:** 210k legacy accounts can still require >10ms CPU (historical isolated V8 sample P95 ~14.0ms). Their hashes cannot safely be converted without plaintext. A user-authorized email-verified password reset creates the new lower-cost scheme. Do not silently require mass password reset or expose/reset credentials to bypass this.
- Historical baseline local V8 P95: 100k login ~8.1ms and registration ~8.7ms. Lowering new hashes should reduce derivation CPU, but **must be verified on live Worker CPU analytics** because local V8 profiles are not edge CPU accounting.

### 3. No financial or auth invariants weakened
No changes to payment/refunds, subscription/credit balance, idempotency, signature/webhook verification, D1 schema/index/migrations, existing Worker secrets, session validation or financial audits. Admin history remains at its existing 30-second per-isolate coalescing; budget, active model and auth remain fresh.

## Acceptance criteria before moving to Workers Free
1. GitHub PR and full-suite CI plus local isolated workerd D1 rows-read parity and exact-model totals all green.
2. Obtain **real** current Cloudflare Analytics for Production (CPU P50/P95/P99 + exceededCpu, daily Worker requests, D1 rows_read/written); this requires viewer permission and **must not** cause a D1 SQL query.
3. Exercise representative legitimate paths using synthetic/local fixtures and, if already approved, **read-only** production telemetry: new password login, 100k and 210k legacy login, registration/reset, sessions, subscriptions, AI reserve/ACK, admin report, signed fiat and five-chain USDT webhook.
4. Do not downgrade if the expensive legacy login consistently violates 10ms, if any critical payment/entitlement request hits an execution limit, or if realistic growth breaches D1/free request budgets. Rebalance design or retain Paid.
5. If deploying Worker after review: use immutable Production release artifact with same source hash, verify all environment binding/Secret counts and payment controls, use protected workflow, and confirm monitoring. Do not ship or deploy via bare Wrangler settings upload.
6. Rollback code through the protected Production Worker deployment only (previous Worker version), with no D1 migration, no old-database restore, no hash rewrite. **New 60k hashes would need verifier support on rollback**: if reverting to pre-60k code, authentication for any newly created or reset passwords may fail. Therefore a safe rollback must include `SUPPORTED_ITERATIONS` for 60k or use a deliberate compatibility shim; never blindly roll back Worker after new hashes are issued.

## Source and evidence
- Historical incident and query measurements: `docs/operations/d1-read-efficiency-2026-11-02.md`.
- Earlier Free investigation: GitHub PR #11 and `docs/operations/workers-free-compat-2026-11-03/cpu-table.md`.
- Cloudflare published Free quota documentation: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/.

**Status:** Not certified Free-compatible without fresh Production CPU and D1 usage data. Passing CI certifies code regressions, not external account economics or performance under real traffic.
