# Xiaodou RSA2 — Production cutover, approval and rollback (2026-11-11)

**Status: NO-GO / preparation only.** This is a checklist for Draft PR #103. It neither approves nor triggers any database, Worker, secret, merchant, production-payment or Chrome operation. Current Production remains on MK99; preserve signed settlement and refunds for all historical orders.

## Source, automated evidence and local rehearsal

- Base: Production release/production 8200608265c1f71e08a55d4d05b7d73debe76f53.
- Staging-verified payment code was ported into the isolated Draft PR #103. Final production code still needs its own exact-SHA release-branch CI, Production build, and explicit deploy approval.
- Unapproved 0025 SQL lives only at api/sql-proposals/0025_subscription_xiaodou_rsa2.sql. Production api/migrations remains 24 files ending in 0024. CI must fail if a new migration is accidentally introduced into that directory.
- Run locally: node scripts/xiaodou-production-local-rehearsal.mjs. It applies all 24 committed migrations and the exact proposal on disposable in-memory SQLite, seeds a paid historical MK99 subscription with a signed payment event, compares old transaction/event rows exactly before and after, admits a Xiaodou transaction, and checks foreign keys, integrity, missing entitlements and closed purchase defaults. This does NOT guarantee equivalent Cloudflare D1 behavior on real rows.
- Read-only Worker binding-name inventory on 2026-11-11 shows Production missing Xiaodou RSA2 merchant credential bindings and readiness flags. Staging has equivalent binding names; do not copy staging keys by assumption, do not expose secret values, recheck on the exact future deploy date.

## Separate explicit approvals needed — in order

1. **Remote Production D1 read-only assessment**, including every SELECT, PRAGMA, EXPLAIN or schema probe. Even read-only D1 requires fresh and action-specific permission. Verify deployed schema, applied-migration ledger, existing MK99 subscription/credit payments and events, pending/unknown orders and latest backup status. No speculative D1 reads.
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

## Unresolved release blockers

- No Production D1 0025 authorization, remote assessment, approved backup or execution.
- No Production RSA2 credential binding names or network access confirmation in most recent read-only inspection. Vendor IP allowlist is disabled per user; new flag still needs separate approved Production configuration.
- No exact-SHA protected Production release build or real Production signed Xiaodou acceptance.
- PR #103 stays Draft and unmerged; current payment merchant stays MK99.
