# Free-first password-only CPU profile — 10k PBKDF2 compatibility (2026-11-17)

## Owner decision
Keep username/email + password login. Do not implement email OTP login (draft PR #170 closed and never merged/deployed). Operator explicitly accepts lower offline password-guessing resistance to target Cloudflare Workers Free (10ms CPU per HTTP invocation). **10k PBKDF2 is far below OWASP's current guidance**. Never represent this as a best-practice password hash strength; trade-off is real.

## Strict compatibility/rollout
The previous release supported exactly 60k/100k/210k password work factors. This candidate ALSO verifies 10k, while default creation remains 100k. Existing PASSWORD_FREE_CPU_ENABLED=1 alone continues to create 60k, unchanged. Only both **PASSWORD_FREE_CPU_ENABLED=1 and PASSWORD_FREE_TINY_CPU_ENABLED=1** create 10k. PASSWORD_LEGACY_MIGRATION_ENABLED=1 is separately required for post-login migration. All flags OFF unless explicitly approved.

Do NOT create new 10k hashes until this compatible code is deployed and an independently approved rollback artifact ALSO verifies 10k. Rolling back to old code after creating 10k users **locks out those users** because its verifier rejects the new iteration count. This is a mandatory release gate.

During Workers Paid, enable all three flags by separate, specific approval. On successful password login, legacy 60k/100k/210k is verified at original cost, a 10k hash is generated with a **fresh random 16-byte salt**, and a compare-and-set D1 password_hash update runs only for active users. Failed passwords, frozen accounts and concurrent password reset are protected; session issue is unchanged. The first login is more expensive than normal, so **never switch to Free during migration**. Inactive/nonlogin legacy users cannot be converted without their password. The owner may ask them to use the existing password-reset flow (NOT passwordless login), or keep Workers Paid for compatibility. Do not leak stored password data or query remote D1 without express approval.

No users, balances, subscriptions, credit grants, sessions, identity rules, email routes, payment/Webhook or USDT configuration changed; no database schema migration.

## Readiness and limitations
The admin-only aggregated password readiness now adds tinyCpuReadiness: active 10k hashes, active non10k, inactive non10k, whether all password hashes are 10k, and which tier is selected. No email, ID, hash, salt or password is returned. Request is an on-demand D1 aggregate **inside the application** for an authorized admin and has no scheduled full-table scan. Research access to remote D1 remains forbidden without separate user permission.

The goal is to reduce registration, reset, ordinary sign-in and admin reauth CPU *after credentials migrate*. This cannot prove Cloudflare Free eligibility: provider API parsing, auth checks, AI generation, payment callbacks, D1 read amplification, and any remaining >10ms CPU requests must be resolved separately. Use complete UTC days across all Worker and D1 assets and route-level CPU evidence before switching plan.

## Testing & manual staging rollout
Run full release CI, TypeScript, synthetic isolated local D1 migration tests, old hashes, wrong password, frozen account, rollback compatibility tests and verify existing rollout flags. Verify password reset and admin reauth under Staging with existing accounts. Stage code safe-off; then explicitly approve 10k activation and observe passwords migration on Workers Paid. Keep compatible rollback; do not deploy or downgrade Cloudflare solely because this PR passes.
