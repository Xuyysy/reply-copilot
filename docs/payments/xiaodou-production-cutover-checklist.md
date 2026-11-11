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
3. **Production RSA2 secret provisioning and source IP**, separately authorized: XIAODOU_BASE_URL, XIAODOU_APP_ID, XIAODOU_KEY_ID, XIAODOU_PRIVATE_KEY, XIAODOU_PLATFORM_PUBLIC_KEYS. Keep private material in Secret bindings and do not copy or echo it into logs. Verify exact merchant authorization, verified egress/source IP and allowlist, callback identity and platform signed GET with a read-only provider diagnostic under operator approval.
4. **Backward-compatible Worker and Pages release**, separately authorized, after approved D1 and secret gates: merge reviewed source on release/production, require full Push CI and independent Production-build on the same exact SHA, artifact integrity check and protected environment. Pin live Worker/Pages and rollback version. Deploy with active_merchant still MK99 and verify both old MK99 and new code are compatible. Do not switch the merchant in a deploy step.
5. **Actual merchant flip**, a distinct explicit operator approval following signed real Staging verification of the four 30-day subscription tiers (purchase, renewal, upgrade) and credit packages, source-IP readiness and verified historical callbacks. Start with approved Xiaodou Alipay channel only. WeChat needs separate platform/merchant approval. Record audit reason and owner, observe checkout/settlement telemetry, and never auto-change the merchant based on a green CI.

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

## Unresolved release blockers

- No Production D1 0025 authorization, remote assessment, approved backup or execution.
- No Production RSA2 credential binding names or confirmed egress/source IP in most recent read-only inspection.
- No exact-SHA protected Production release build or real Production signed Xiaodou acceptance.
- PR #103 stays Draft and unmerged; current payment merchant stays MK99.
