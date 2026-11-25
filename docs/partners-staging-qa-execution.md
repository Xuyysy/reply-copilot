# Independent Partners Staging QA — execution record

Authorization: owner explicitly authorized isolated Staging deployment, D1 read/write and internal testing on 2026-11-25. Scope excludes existing Staging and production resources, real provider traffic and actual funds. Do not hand off to owner before internal hosted QA passes.

## Verified candidate
- Exact source: ff8a2e2c7e85f2faf56232739d280415f964ef9d.
- PR full CI 45630519954 passed 1575/1575, focused 91/91 and Chrome QA.
- Exact-head Push CI 45630510461 passed full suite, browser acceptance and package.
- Artifacts 15030861412 (Staging Pages), 15030951296 (Staging extension), 15030223537 (logs).
- Existing Staging artifact is built for the shared Staging API. **Do not deploy that artifact as an isolated QA site**; rebuild from the pinned source with the isolated API origin.
- Prep CI 45631608855 passed; artifact 15031605539 contains migration manifest and bundled Worker (no deployment).

## Actual new D1
Created only reply-copilot-partners-qa-20261125 (UUID 22f7a8f1-28c1-42ad-a69d-54ee8bc7e5dc) in the verified account hosting the existing application. No existing D1 was queried.
- Applied 33 exact-source SQL files in verified order, each recorded in QA-only qa_schema_migrations.
- 81 application tables, 73 explicit indexes, 44 triggers, plus QA migration journal. Counts match local manifest. Foreign key check empty.
- 13 partner feature flags off, payout minimum 1000 fen.
- Disabled registration, purchase, AI and payment enable/release settings in QA only.
- Seeded 7 synthetic profiles with zero balances, no password hashes and no sessions: qa-admin, qa-partner-a, qa-buyer-b, qa-buyer-c, qa-outsider-d, qa-excluded-e (marked test account), qa-partner-f. Exactly one singleton admin in the isolated database. These are not usable logins yet. No real payments, orders, or commissions.
- Both discovery query plans use their new applied-time indexes in actual D1. The zero-state invariant query read 48 rows, wrote 0, D1 duration 0.2024 ms. This is not a load or CPU benchmark.

## Next hosted deployment gate
Use a new protected Worker/website target only, never the existing protected staging deployment workflow or credentials. Verify exact build SHA, new D1 binding ID, private access control before enabling an endpoint, dedicated keys/password hashes via an approved secure mechanism, and no actual payment/AI/email credentials. Existing source excludes production pilot writes; keep this unchanged. Test user and admin sign-in, all six roles, discovery/accrual/refunds/payout, browser flows and actual resource metrics. Retain financial test records in the isolated QA DB only. Stop on any failure; no owner handoff until passed.

Current state: remote schema and account profiles initialized; no hosted Worker/Pages deployed, no user login credentials initialized, no QA endpoint exposed. Available GitHub deployment credentials are gated for existing Staging; do not bypass that boundary. Prepare isolated artifact upload/credential path before deployment. No merge, shared Staging/production changes, provider calls or real transfers.
