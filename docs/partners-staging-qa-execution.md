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

## Hosted deployment checkpoint (2026-11-26)

- QA build CI 45739027167 passed: exact candidate ff8a2e2c, 48 assets, isolated same-origin API, verified no shared/production API strings.
- Direct connector artifact retrieval by Cloudflare returned HTTP 403. Transferred 64 compressed chunks via temporary QA-only D1 table; verified raw and compressed SHA-256 of both modules before upload (worker.mjs facb149dba42d6d858dcb47a7143076cfaeed93733a2cea48e5137a84b893079; assets.mjs 80dc7d088b317977eb1386bd5c33455ef21cca70d9b0958ee4f28d7b7113ff02). Removed temporary transfer table after upload and binding verification.
- Uploaded new Worker reply-copilot-api-partners-qa; initial deployment/version response 1240595cd8344b2aa94d9a0849aa700c. Its wrapper is versioned at api/qa/partners-hosted-wrapper.mjs. Same-origin HTML and API, secret outer Basic gate for every route, exact host check, explicit API allowlist, no live payment/registration/email/provider routes, no shared credentials. Secret generated within Cloudflare; no plaintext in GitHub logs. Separate Pages project unnecessary for this QA architecture.
- Verified actual deployment settings: dedicated D1 UUID, environment staging, payment ceiling off, AI mock, scheduled off, 4 separate secret bindings, workers.dev enabled and previews disabled. QA_ACCESS_SECRET rotated once for browser attempt.
- **Hosted verification remains blocked**: Cloudflare execution fetch returns 403 "Forbidden: requests to [QA host] are not allowed" even with authorization; Browser Rendering returns access-denied HTML rather than Astro page; local container DNS resolution fails. This is not an application response/acceptance result. Added independent no-credential GitHub runner connectivity probe (must return exact 401 and QA Basic realm); results pending. For subsequent internal QA use a secure approved short-lived test credential mechanism, not plaintext in repository/logs. A narrowly scoped GitHub OIDC-based QA access design is a possible option, not implemented/approved by CI yet.
- Current QA D1: 33 migrations, 7 synthetic profiles, 0 initialized passwords, 0 sessions, 0 commissions, 0 enabled partner flags, FK check clean, no transfer table. No account handoff, no actual hosted browser/business QA pass, no real provider calls or funds. Shared Staging and production untouched.


## Temporary account retirement boundary

Owner requested disposable QA identities, frozen after testing. Reuse the existing authorized lifecycle, never unfreeze historical shared/production test accounts. Log out and verify session revocation before freezing; freeze alone is not session revocation. Preserve all synthetic financial records. Existing archive rejects accounts with payment/order history; these remain frozen, not archived. Do not change test-account markers during financial acceptance to evade eligibility checks. The singleton admin cannot freeze itself through the admin API; its final credential removal and endpoint retirement remain operator-reviewed. Individual archive/status routes require UUIDs, whereas the isolated QA aliases are not UUIDs; do not expose extra admin routes or change production semantics for cleanup. The QA wrapper intentionally does not allow general user-administration writes. This branch extends only local disposable SQLite authentication acceptance to verify logout, bulk freeze, CSRF, singleton protection, and frozen-password denial. It is not permission for remote credential provisioning or cleanup. Hosted cleanup is not executed and remains part of the approved independent-environment procedure.


## Hosted login acceptance — 2026-11-26

Owner completed the manual isolated Secret and password-hash initialization. Exact-tree trigger b306ecd77281320c4f8e92d03d1e11cd0ca50f92, protected GitHub run 45752508695 / job 139683373238, completed successfully at 04:01:45 UTC. Seven actual hosted password logins, bad-password/origin denial, CSRF, reauthentication, role separation, private Basic gate, HTML, blocked registration/payment routes, logout and revoked-session denial passed. No secrets were retrieved by the operator. Cloudflare metadata independently confirmed QA Worker version f795368a-8a76-4dbb-ba24-ae5edc3bb961 at 100%, exact isolated D1 binding, payment and scheduled ceilings 0, no cron, no provider secrets. Post-test read-only aggregate on authorized isolated D1: 33 migrations, 7 profiles, 7 initialized passwords, 0 active sessions, 0 commissions/payouts/recharge/subscription orders, 0 enabled partner DB flags; 94 rows read, 0 written. No shared environment queried. Hosted browser and synthetic financial lifecycle remain separate gates.
