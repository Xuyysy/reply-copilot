# CF Free CPU: auth-key import reuse, staged legacy credential migration, and admin readiness (2026-11-17)

## Ground truth and why the CPU blocker is still open

The previous CF Free D1 batches were published to Worker and Pages source SHA `d0a7f75d33d4d744052387c5fd19425512967efd`, confirmed by live Cloudflare deploy IDs, 56 preserved bindings, payment/USDT settings and GitHub Actions success.

Read-only Cloudflare GraphQL `workersInvocationsAdaptive` around UTC 2026-11-17 07:00 recorded **30 HTTP 200 invocations** of new Worker version `3ab4eb62-226f-4114-8b37-8c35c0f9ab15`: **CPU P50 3.055ms, P95 15.061ms, P99 24.075ms**, maximum 24.075ms. This is a **small sample**; the data is per-Worker, not per-route. We cannot claim these requests were password operations. **CPU Free 10ms per request is not yet proven**, and actual live 15-24ms tail remains the blocker. D1 Free 5M rows-read/day requires separate complete-day confirmation; a few short 15-minute postrelease samples are not a daily quota measurement.

Official Cloudflare source: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/ . Cloudflare production timers freeze during pure computation; locally measured wall times are not billed Worker CPU and cannot certify Free.

## Delivered complete feature

### 1. Cache HMAC CryptoKey imports without changing any auth digest

`api/src/security.ts` still computes HMAC-SHA256 using the **same auth secret, same value, same encoding, same signed bytes and same digest**. The module now reuses the non-extractable imported key in a `WeakMap` keyed by Worker `Env` identity. It:
- deduplicates repeated imports across login rate-limit IP/email HMACs and compatible repeated authenticated requests;
- never reuses an imported key across distinct `Env` binding objects; changes to `AUTH_HASH_SECRET` invalidate the cache even if the same Env object is reused;
- evicts failed imports on rejection, so future requests retry normally;
- preserves explicit fail-closed short/missing secret behavior.

The runtime may create distinct Env binding identities between invocations; reuse is **not guaranteed across requests**, only where an Env object is reused. No underlying cryptographic security change, secret export, cross-tenant cache, D1 write or endpoint change.

### 2. Legacy password conversion — explicit two-switch Paid-stage opt in

Existing password work factors: new/default PBKDF2-HMAC-SHA256 100k, opt-in new 60k, legacy 210k (all three verifiers supported). Add **`PASSWORD_LEGACY_MIGRATION_ENABLED=1`**, which has **no effect unless `PASSWORD_FREE_CPU_ENABLED=1` too**.

When both flags are explicitly on **while still on Workers Paid**:
1. Verify the login using the original stored iteration count and preserve the existing rate limits and frozen-user block.
2. Create and commit the normal authenticated session as before.
3. If the user is active and the verified password hash is legacy 100k or 210k, generate a fresh salted 60k hash from that **already verified plaintext password** and execute an optimistic `UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND status='active'`. Password reset / concurrent credential change wins safely; 0 updated rows means no mutation.
4. Failure of the optional migration write never denies or alters the already valid login; no hash/pepper/password/email data is logged or returned. Incorrect credentials and frozen accounts never migrate. Already optimized passwords never rehash on each login.

**Important caveat:** A first legacy login during migration performs BOTH original work factor AND new 60k PBKDF2. It is therefore **even more CPU expensive on that first login** and must happen **on Paid before switching plans**. Neither enabling flags nor these code changes eliminate 210k CPU for dormant accounts. User-initiated email-verified password reset is an alternative to migrate dormant credentials. Never force resets without a separate user communication and risk review.

**Security tradeoff:** 60k PBKDF2 is weaker for offline guessing than 100k/210k and below contemporary high-security recommendations. Existing 12-char minimum, random 128-bit salt, mandatory server pepper, current verification, registered email verification, rate limits, fraud controls and frozen-user enforcement remain unchanged. Keep flags **OFF by default**, as on current Production.

### 3. Readiness UI: privacy-preserving and intentionally manual

The authenticated `GET /v1/admin/security/auth-cpu-readiness` endpoint performs a single aggregate of account password *prefix types* **only when the administrator clicks** “检查密码 CPU 迁移准备情况” under Admin → System and Security. This is ordinary authenticated product functionality, **not remote SQL executed by tools or automated巡检**.

The response includes active counts of 60k, 100k, 210k, unsupported, and non-active legacy hashes; no identities, stored hashes, salts, keys or password attempts leave D1. It deliberately sets `freePlanCertified:false` unconditionally and distinguishes zero legacy accounts from Free CPU feasibility. The UI never polls it.

## Regression, deployment, rollback and Free NO-GO criteria

- New tests cover HMAC digest byte parity, per-binding import reuse, secret rotation and import retry, password migration from 100k and 210k, both-flag requirement, wrong-password/frozen-account lockout, no money mutations, concurrent reset CAS, admin-only aggregate authorization and UI manual fetch.
- Run CI (including all payments, subscriptions, USDT, ACK, refunds) and immutable Production Build against exactly the same release SHA. **No D1 schema migration.**
- **Phase A:** deploy compatibility Worker and changed admin Pages through the protected Worker→Pages workflow, keeping `PASSWORD_FREE_CPU_ENABLED` and `PASSWORD_LEGACY_MIGRATION_ENABLED` ABSENT/OFF. Verify all existing bindings including five USDT networks, payment keys, D1 and existing session behavior.
- **Phase B (separate explicit operator approval):** if accepting weaker offline attack resistance, set both flags `=1` on Paid through a separately reviewed, preservation-safe config change that neither removes/overwrites other bindings nor uploads a raw Wrangler configuration. Do not change flags as part of this PR or base deploy.
- Before Free: ask users to sign in/reverify or reset passwords; manually check the admin readiness aggregate until active, unsupported and potentially reactivated legacy accounts all equal zero. Never claim sleeping users have been migrated.
- **Phase C:** read-only account GraphQL metrics must show D1 rows-read under 5M/day with growth margin (prefer <3M), D1 writes <100k/day, account Worker requests <100k/day, and **critical routes all strictly within 10ms CPU per invocation** with acceptable P99/max and zero `exceededCpu`. Worker aggregate P95 alone is insufficient; use Cloudflare CPU profiler for the remaining high-CPU route details.
- The minimum compatible rollback Worker must recognize 60k *and* 100k/210k hashes. Do not roll back to an old Worker lacking a 60k verifier after any 60k account has been created or migrated. Readiness route removed by older rollback does not damage accounts but hides migration visibility.
- No tool/script remote Production/Staging/replica D1 SQL, no changes to payment rules, subscription funds, refund paths, credit ledger or app-held secrets. All direct SQL tests run in local synthetic fixture.

**Decision for now: Free remains NO-GO.** This batch delivers safer migration capability and cuts repeated authentication key-import CPU overhead; it does not certify the system can already run on Free.
