# BoltUtil USDT multi-network payments — Staging-only implementation notes

> Draft PR #127 / Issue #126. Source-only until explicit owner approval. **No remote D1 SQL**, no real payment creation, no Secrets changes, no Worker/Pages deployment. This is NOT a completed mainnet acceptance test.

## Scope
USDT only, non-custodial, directly to owner's configured wallet. Exactly three networks:
- `TRC20` — TRON USDT `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t`, 6 on-chain decimals.
- `POLYGON` — Polygon PoS USDT `0xc2132D05D31c914a87C6611C10748AEb04B58e8F`, 6 on-chain decimals.
- `BEP20` — BNB Smart Chain USDT `0x55d398326f99059fF775485246999027B3197955`, **18 on-chain decimals**.

BoltUtil order `amount` uses at most six decimal digits on **all three networks**. On create, never display the submitted amount over the returned `payment.amount`. Verify `payment.rawAmount` against `payment.amount * 10^payment.decimal`, with integer precision and no Number arithmetic on raw token units. Payment wallet must be `payment.address`; never the token contract.

Official provider documentation:
- https://boltutil.com/developer-docs?s=networks
- https://boltutil.com/docs/usdt-integration
- https://boltutil.com/developer-docs?s=create
- https://boltutil.com/developer-docs?s=status
- https://boltutil.com/developer-docs?s=webhook

## Independent merchant selection
`active_merchant` (MK99 / Xiaodou / none) and `paymentControl` are fiat only. USDT availability and routes use their **own** flags and credentials. The customer sees USDT regardless of which fiat merchant is selected, provided BoltUtil itself is ready.

Initial deployment guardrails, Staging Worker only; **default all OFF**:
- `BOLTUTIL_SCHEMA_READY=1` only **after** separate operator-approved Staging D1 migration and verification.
- `BOLTUTIL_ENABLED=1` — independent USDT checkout enable.
- `BOLTUTIL_STAGING_CREATE_ENABLED=1` — explicitly permit **real** BoltUtil invoice creation. This is NOT a sandbox.
- `BOLTUTIL_TRC20_ENABLED=1`, `BOLTUTIL_POLYGON_ENABLED=1`, `BOLTUTIL_BEP20_ENABLED=1` — each network approved and configured with a wallet on the provider.
- `BOLTUTIL_CNY_PER_USDT_MICROS` — a vetted fixed CNY/USDT rate in micro-CNY. This is a **Staging-only fixed quote policy**. Rates cannot be invented; volatility and fees are the owner's responsibility.
- `BOLTUTIL_API_KEY`, `BOLTUTIL_WEBHOOK_SECRET` — use Workers secrets; **never copy these to logs, repository or chat**.
- Existing `SUBSCRIPTIONS_ENABLED` and `SUBSCRIPTION_PURCHASES_ENABLED` still guard new subscription sales; no paid entitlement bypass.

Customer endpoints:
- `GET /v1/boltutil/availability` — network list and independent readiness.
- `POST /v1/boltutil/upgrade-quote` — subscription upgrade price proof (no payment).
- `POST /v1/boltutil/orders` — creates an immutable network-specific invoice with idempotency key, logged-in web session, origin and CSRF.
- `GET /v1/boltutil/orders`, `GET /v1/boltutil/orders/:id` — customer order visibility.
- `POST /v1/boltutil/orders/:id/refresh` — trusted status query and attempted idempotent settlement.
- `POST /v1/boltutil/webhook` — signed event (raw-body HMAC) triggers mandatory merchant-authenticated status query.
- `GET /v1/admin/boltutil/orders` — read-only Staging USDT ledger, not included in CNY revenue.

UI: `/pricing/` offers USDT for permanent packs and 30-day subscriptions; `/usdt-checkout/` lets the buyer choose one of three enabled networks before creating the invoice. Network is immutable once created. `/account/` remains authoritative for actual credited entitlements.

## Data model
`api/sql-proposals/0028_boltutil_usdt.sql` is an **unapplied proposal**. Confirm the correct next migration filename against current branches, Staging-only 0025 and existing 0026/0027 proposals; don't overwrite or auto-run. BoltUtil order/event records are separate from fiat CNY payment transactions. Permanent credits use the existing `recharge_orders` / `credit_batches` / `credit_ledger` atomic grant invariants. Subscriptions remain `subscription_orders` / `subscription_periods` / `subscription_tier_changes` and **must never** become purchased permanent credits.

## Acceptance and non-negotiable controls
- Three networks × credits / Basic / Pro / Max / Ultra × purchase / renewal / upgrade (as eligible), with MK99 / Xiaodou / none merchant selector matrix.
- HMAC verification, freshness ±5 min, exact body, failed/rate-limited provider queries, unknown creation recovery and idempotency.
- Confirmed **EXACT** payment only. No entitlement for `PENDING`, `PAID`, `EXPIRED`, `FAILED`, any `MANUAL_*` settlement, unpaid amount or wrong network / recipient / token.
- No double-grants on webhook replay, concurrent reconciliation or overlapping same amount. Unresolved payments and in-progress orders must remain recoverable.
- Crypto gross paid amount / network fees / fiat face price tracked separately; never mix USDT micros into CNY revenue.
- Verify original fiat MK99, historical Xiaodou callbacks, 200 signup credits, invite grants, subscription 24h buckets, ACK reservations and Creator Momentum/CMI eligibility.
- Test with local fixtures before separately authorizing Staging migration + deployment, then separately authorizing a small **mainnet** transfer per network. BoltUtil has no public simulated-payment sandbox.

## CI
Follow `AGENTS.md` and the latest Notion CI policy. Nonrelease intermediate pushes may use `ci-lite:`. Final exact-SHA push must omit that prefix and pass **full** CI and generated artifacts. Draft PR CI is not enough for release.
