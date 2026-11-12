# Xiaodou RSA2 — Production cutover, approval and rollback (2026-11-11)

**Status: NO-GO / preparation only.** This is a checklist for Draft PR #103. It neither approves nor triggers any database, Worker, secret, merchant, production-payment or Chrome operation. Current Production remains on MK99; preserve signed settlement and refunds for all historical orders.

## Source, automated evidence and local rehearsal

- Current Production integration base: `release/production` SHA `03d687cabb7032f8901f23fbe35f8fcae711fc74` (contains the accepted Momentum Analytics terminal). PR #103 integrates on top, but stays Draft and unmerged.
- Staging-verified payment code was ported into the isolated Draft PR #103. Final production code still needs its own exact-SHA release-branch CI, Production build, and explicit deploy approval.
- Unapproved 0025 SQL lives only at api/sql-proposals/0025_subscription_xiaodou_rsa2.sql. Production api/migrations remains 24 files ending in 0024. CI must fail if a new migration is accidentally introduced into that directory.
- Run locally: `node scripts/xiaodou-production-local-rehearsal.mjs`. It applies all 24 committed migrations and the exact proposal **inside an explicit disposable-memory transaction**, seeds a paid historical MK99 subscription with a signed payment event, compares old transaction/event rows before and after commit, admits a Xiaodou transaction, and verifies foreign keys, integrity, no granted entitlements and closed purchase defaults. The proposal must **never** run `PRAGMA defer_foreign_keys=off` before commit: Cloudflare documents that it discards outstanding deferred violations. This local rehearsal is NOT remote D1 validation or backup evidence.
- Read-only Worker binding-name inventory on 2026-11-11 shows Production missing Xiaodou RSA2 merchant credential bindings and readiness flags. Staging has equivalent binding names; do not copy staging keys by assumption, do not expose secret values, recheck on the exact future deploy date.


## Completed restricted Production D1 read-only audit (2026-11-11)

The owner separately approved **only seven SQL audit groups** against the verified Production D1 `reply-copilot-production` (ID `d9df7d23-9b9c-44ac-a33a-c24474c15691`). Those queries have been completed; they do **not** authorize any subsequent D1 SQL, backup/export, mutation or merchant change.

- The nine named tables exist (including `system_settings`); the latest registered migration is `0024_subscription_upgrade_quotes.sql`. No registered 0025.
- Subscription payment transaction columns: **19** matching the 0022/0023 schema. Payment event columns: **8** matching. Event `transaction_id` has a `RESTRICT` foreign key to the transaction `id`.
- MK99 subscription transactions: **3 paid + 2 closed**; MK99 subscription payment events: **3**; subscription orders: **3 paid purchases + 1 closed purchase + 1 closed renewal**; active subscription periods: **3**.
- Legacy MK99 credit transactions: **11 paid + 3 closed**; recharge orders: **11 paid + 3 expired**.
- `active_merchant=mk99`, `purchase_enabled=1`, `payment_mk99_enabled=1`, `payment_rsa2_enabled=1`, `payment_rsa2_alipay_released=0`. General RSA2 enable does **not** mean Xiaodou Alipay is released or currently selected.
- Query metadata reported **0 rows written**. These are aggregate/schema observations only, not per-order reconciliation or proof of complete ledger integrity; exact financial records must be protected by approved backup and a distinct migration verification window.
- Production Worker still has **none** of the five required Xiaodou RSA2 merchant secret bindings, nor the allowlist-disabled mode confirmation binding. No secrets were read.

**Do not repeat the audit without fresh action-specific approval.** The next separately approved phase is a protected backup/bookmark and verified recovery plan. A subsequent, distinct approval is needed for the exact, newly hashed 0025 proposal, its transaction and post-migration financial reconciliation; never merge, deploy or switch merchant merely because the offline checks are green. Cloudflare D1's official foreign-key guidance warns that `PRAGMA defer_foreign_keys=off` discards outstanding violations instead of raising at commit; the proposal now relies on commit-time enforcement: https://developers.cloudflare.com/d1/sql-api/foreign-keys/ .

## Separate explicit approvals needed — in order

1. **Read-only schema/aggregate assessment COMPLETE on 2026-11-11**, for the individually approved seven query groups described above. This does not authorize any further SQL. Future re-audits require new, explicit permission.
2. **Production D1 backup and 0025 migration**, an independent approval specifying D1 database, secure backup destination/expiry, tested recovery plan, exact SQL content SHA, migration execution window and authorized operator. Verify D1-specific foreign-key deferral, table recreation and indexes before executing. No automated migration from CI or PR merge.
3. **Production RSA2 secret provisioning and network access mode**, separately authorized: XIAODOU_BASE_URL, XIAODOU_APP_ID, XIAODOU_KEY_ID, XIAODOU_PRIVATE_KEY, XIAODOU_PLATFORM_PUBLIC_KEYS. Keep private material in Secret bindings and do not copy or echo it into logs. User confirmed the merchant IP allowlist is disabled. The alternative `XIAODOU_IP_ALLOWLIST_DISABLED_CONFIRMED=1` requires separately approved Production configuration; original `XIAODOU_SOURCE_IP_CONFIRMED=1` remains for verified egress. Verify merchant status, callback identity and signed GET under operator approval. Neither confirmation is auto-set.
4. **Backward-compatible Worker and Pages release**, separately authorized, after approved D1 and secret gates: merge reviewed source on release/production, require full Push CI and independent Production-build on the same exact SHA, artifact integrity check and protected environment. Pin live Worker/Pages and rollback version. Deploy with active_merchant still MK99 and verify both old MK99 and new code are compatible. Do not switch the merchant in a deploy step.
5. **Actual merchant flip**, a distinct explicit operator approval following signed real Staging verification of the four 30-day subscription tiers (purchase, renewal, upgrade) and credit packages, confirmed network access mode and verified historical callbacks. Start with approved Xiaodou Alipay channel only. WeChat needs separate platform/merchant approval. Record audit reason and owner, observe checkout/settlement telemetry, and never auto-change the merchant based on a green CI.

## Financial GO criteria

- Checkout first discovers and restores an existing same-account, same-package unresolved order. Its historical order ID, merchant identity, currency and buyer amount are immutable. Concurrent duplicate POST, multiple tabs, a changed payment channel, stale cashier, unknown/ambiguous states and after-return refresh cannot generate or charge a second order without verified closure.
- Checkout creation response is never financial proof. Only authenticated merchant query, verified callback and idempotent ledger application grant one permanent credit batch or one subscription period. A user return URL, screenshot, unsigned status or provider outage must not grant credits.
- Verified amount exactly equals public buyer-facing CNY total. New Xiaodou seller-borne fees do not rewrite historical MK99 buyer-borne amounts or original fee snapshots.
- Existing MK99 refunds, callbacks, paid/queued subscription renewals and purchase entitlements still work even after switching new-order routing. Watch manual_review, unknown, duplicate grant, missing callback, pending checkout and entitlement reconciliation independently.
- Production D1 backup/migration is verified with real-schema evidence only after D1 approval; local SQLite passing is not proof of remote D1 readiness.

## Rollback and incident response

- If payment verification or entitlement consistency becomes uncertain: stop NEW sales with an authorized operator action; preserve every pending/unknown order, historical signed provider event and captured checkout attempt. Do not automatically create a replacement purchase.
- Switch new-sales routing back to MK99 only by an independently approved, audited operator action and only after verifying MK99 is still ready; **keep verifying and settling old Xiaodou orders against Xiaodou** after new-sales routing reverts.
- Roll back Worker/Pages binaries only when compatible with any already-written Xiaodou subscription rows. Once real Xiaodou orders exist, NEVER blindly drop/revert 0025 tables or restore a stale snapshot that erases payment history.
- Refunds, manual grants, dispute handling, Production SQL repair, credentials rotation and live transactions each require their own approval. No trial Production charges in this task.


## One-command Production cutover readiness (offline feature)

Run from repository root:
- `node scripts/xiaodou-production-readiness.mjs` — local checks and explicit NO-GO blockers, no remote connections.
- `node scripts/xiaodou-production-readiness.mjs --evidence docs/payments/xiaodou-production-readiness.example.json` — evaluate a **sanitized** operator evidence claim packet. Exit code 2 means blockers; exit 0 means only that the supplied claims appear internally complete, **not** that authorization was granted.

This single feature checks the 24-migration boundary and local 0025 historical MK99 replay, Production Worker identity and D1 isolation, proposal SQL SHA-256, authorized D1 audit and backup claims, **exact five RSA2 secret binding names and types** (never their values), explicit allowlist-disabled or verified-egress flag matched to the stated mode, signed provider GET/Webhook and MK99 continuation, exact-SHA full Push CI, independent Production build, pinned rollback Worker, and **independent merchant-switch approval**. Output is structured JSON with phase-level results and actionable blockers. The script never requests D1 data or secrets, makes no network calls, changes no settings, and never deploys, even when every checklist item is marked true. Manual evidence is not cryptographically authenticated.

The example deliberately remains **NO-GO** for Production; do not fill its flags based on assumptions or this chat alone. Each production authorization and observation must come from the relevant operator and can be independently verified only after the matching explicit approval. A green CI is not such approval.


## One-command 0025 synthetic-data migration, local backup and recovery module

Run `node scripts/xiaodou-production-isolated-recovery.mjs` from the repository root, or the focused test `node --test tests/xiaodou-production-isolated-recovery.test.mjs`.

This is an **end-to-end isolated local-only rehearsal** to be executed as one module before the separately authorized real migration. It never accesses Cloudflare, Production D1, real orders, customer rows, API keys or user content. It uses an in-memory SQLite database and an ephemeral **synthetic-only** local backup file, removing the file after checking the restore.

1. Apply the genuine committed Production migrations 0001–0024 to an in-memory database. Seed entirely fictional accounts, three paid and two closed MK99 subscription transactions, three signed synthetic events, three active periods, eleven paid and three closed MK99 credit transactions, eleven paid and three expired recharge orders, and synthetic credit balances. These grouped quantities **mirror the authorized 2026-11-11 Production seven-group read-only audit** without importing a single real customer row.
2. Fingerprint all rows of nine audited financial, account-credit, entitlement and merchant-routing tables. Use Node's local SQLite backup API to produce an isolated temporary backup and reopen it independently; verify hashes, group totals, foreign keys and integrity.
3. Apply the **exact source-only 0025 proposal** to the in-memory working database inside an explicit transaction. Enforce deferred foreign keys at COMMIT, validate integrity and check all nine financial/entitlement/routing fingerprints remain unchanged.
4. On the independently reopened synthetic backup, deliberately interrupt the migration halfway. Verify the transaction rolls back, leaves no temporary migration tables, and preserves every original fingerprint. Separately inject an orphan event: COMMIT **must fail**, then ROLLBACK must restore all synthetic rows and references.
5. Insert a new synthetic Xiaodou subscription transaction into the successfully migrated database. Confirm that this alone **does not** grant an active subscription period, paid credits, or switch the selected merchant away from MK99.
6. Return a redacted machine-readable JSON report with SHA-256 of the SQL proposal, pass/fail booleans and migration count. It **always** reports `productionReady=false` and `productionD1Touched=false`, and never asserts a real Production backup or real migration was completed.

The local backup test is **not** a verified Cloudflare D1 export, Production Time Travel bookmark, restore test of real data, or permission to migrate; the security, consistency and downtime risks of Production must be evaluated separately. Use the previously authorized aggregate audit as a baseline, not as a substitute for a fresh separately approved post-migration audit. Any **new** SQL proposal change creates a new hash and requires a new explicit migration approval.

## One-command five-stage offline Production cutover gate

Run `node scripts/xiaodou-production-cutover-gate.mjs` from the project root.
For a sanitized **unverified operator evidence packet** use
`node scripts/xiaodou-production-cutover-gate.mjs --evidence docs/payments/xiaodou-production-readiness.example.json`.

This command now combines the existing 0025 readiness assessment with the **complete synthetic-only local backup, migration, two rollback paths and historical MK99 preservation** exercise. It returns a single machine-readable JSON report grouping every remaining blocker into these five dependent phases:

1. Source consistency, offline migration and local recovery;
2. Production D1 audited structure, **separately authorized** protected backup and exact-hash 0025 migration;
3. All five Production RSA2 secrets, merchant network setting, signed provider query/webhook and historic MK99 settlement;
4. Exact `release/production` CI/Production immutable build, **independently authorized** compatible Worker release, MK99 still selected;
5. Signed real payment acceptance and a fresh, separate approval to switch new-order routing.

**Every call exits 2 (NO-GO) even with completely green operator-supplied claims.** No input is authenticated merely because an operator submits JSON, and the report has no authority to perform D1 SQL, export, backup, migration, secret updates, Worker/Pages deployment, merchant flip or real charges. A completed offline synthetic exercise cannot prove Production backup or exact real schema migration. The release executor remains the existing protected Production workflow, which must receive distinct explicit approval after its own independent integrity checks.

For implementation regression coverage, run `node --test tests/xiaodou-production-cutover-gate.test.mjs`. The output contains only non-sensitive blocker identifiers and instructions, not secrets, private keys, signed payloads or customer records. **Do not write merchant secrets into the evidence JSON.**

## Unresolved release blockers

- Production D1 seven-group *read-only audit completed*. No approved backup/recovery validation, no 0025 migration execution, and no permission for further remote SQL.
- No Production RSA2 credential binding names or network access confirmation in most recent read-only inspection. Vendor IP allowlist is disabled per user; new flag still needs separate approved Production configuration.
- No exact-SHA protected Production release build or real Production signed Xiaodou acceptance.
- PR #103 stays Draft and unmerged; current payment merchant stays MK99.
