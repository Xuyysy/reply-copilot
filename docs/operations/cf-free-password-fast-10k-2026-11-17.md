# CF Free cost-first password mode (password-only, no email sign-in)
Date: 2026-11-17

## Business decision and explicit security tradeoff

Owner prefers no recurring Cloudflare plan charge at low user volume and explicitly accepts reduced password hash strength. The existing username/email + password login remains unchanged; **no email-OTP login is added**. Password reset emails from the existing workflow remain available.

Candidate PBKDF2-SHA256 iterations: **10,000** instead of 100,000 (default) or 60,000 (previous opt-in). OWASP recommends PBKDF2-SHA256 **600,000** iterations; this is a substantial weakening of offline password-guessing resistance in case the pepper and D1 hashes are both compromised. Maintain 16-byte per-user random salts, the 24+-char server-side PASSWORD_PEPPER, 12-character password minimum, hashed-IP/account D1 rate limiting, CSRF, session semantics. This does not imply "secure to OWASP standard." Do not replace passwords with single SHA-256 or ship plaintext.

## Flags (no switch automatically turns on on merge)

- `PASSWORD_FAST_CPU_ENABLED=1` creates *new* and *reset* hashes at 10k and enables the 10k verifier in production. **Default: OFF**; only exact string 1 activates.
- `PASSWORD_LEGACY_MIGRATION_ENABLED=1` alongside fast mode rehashes a successfully authenticated, active user's legacy password once, after a successful session write; original PBKDF2 CPU is still consumed that first time. Existing compare-and-swap prevents overwriting concurrent resets.
- `PASSWORD_LEGACY_COST_GUARD_ENABLED=1` **AND** fast mode enforce 10k-only verification, returning the existing generic invalid-credentials error for 60k/100k/210k hashes. **Default: OFF.** The existing password-reset form remains available for dormant accounts. Never enable the guard until user migration is verified and an explicit user-support plan exists.
- Existing `PASSWORD_FREE_CPU_ENABLED=1` still means 60k if fast mode is OFF; previous modes and old hash verification remain backward compatible.

## Two-phase rollout and rollback protection

1. Merge and deploy the **compatible verifier** with all new flags OFF to Staging, then verify old 60k/100k/210k and new 10k hashes using isolated fixtures. Production roll-out of compatible code requires separate explicit approval; do not activate yet.
2. While still **Paid**, activate FAST on Staging and validate registration, login, password reset, admin login, admin reauth, revoked sessions, device binding, payment and credit invariants. Test CPU on actual Cloudflare version, not local Node wall time.
3. If approved, activate FAST and legacy migration on Paid Production. Ask the few existing users to log in once, or reset their passwords with the **existing password reset**. An admin-only on-demand `/v1/admin/security/auth-cpu-readiness` reports aggregated 10k/60k/100k/210k counts with no password material; this endpoint is **ordinary app D1 query** and must not be called by this assistant without separate specific D1 approval. Operator can review the UI themselves.
4. **Do not roll back to a Worker version that predates 10k verification** after creating any 10k hashes: it will reject these passwords. Rollback target must be the new compatibility release with new flags OFF.
5. Only after all active accounts, the admin, dormant-account recovery policy, and complete account-wide UTC D1/CPU usage are verified should an operator independently consider the legacy cost guard and Cloudflare Free. It is also necessary to benchmark registration/reset and payment/admin/AI request paths; the CPU 10ms limit is **per request**, not an average.
6. If high CPU remains even with 10k, measure real Worker CPU and fix the actual route; do NOT claim a Free eligibility decision based solely on the password changes.

Cloudflare Workers limits (2026-11): https://developers.cloudflare.com/workers/platform/limits/
OWASP standard: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
