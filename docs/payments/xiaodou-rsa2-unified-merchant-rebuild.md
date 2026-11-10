# Xiaodou RSA2-only rebuild: global merchant switch (2026-11-10)

**WIP — this branch is NOT production-ready.** Protocol source: [uploaded 15-file Xiaodou API snapshot](./vendor/xiaodou/2026-11-10/README.md). One backend `active_merchant` must select **both** permanent credit-package and subscription new purchases. MK99 and Xiaodou may not silently substitute for each other. Historical transactions remain pinned.

## Scope fixed by owner

- Xiaodou: **native RSA2 only**; currently merchant-approved **Alipay only**, no WeChat until actual merchant permission confirmed. Do not use the Epay compat `submit.php`/`mapi.php` for any new order; preserve old Epay signed webhook/refund history.
- Keep MK99 payments and subscriptions live during redevelopment. No live merchant switch, credential transfer, D1 remote SQL (even SELECT), real payments or production deployment in this PR.
- Epay retirement and admin fail-closed merchant guard are the **first implementation slice only**; Xiaodou subscriptions and full switch are not complete.

## Critical schema blocker

Current deployed `api/migrations/0022_subscription_core.sql` defines `subscription_payment_transactions.merchant_provider CHECK(merchant_provider IN ('mk99','local_mock'))`. It is **not possible** to create a Xiaodou subscription row by merely changing the global merchant setting. Design and test an additive D1 migration for a parallel Xiaodou transaction/proof representation (or safe SQLite table rebuild with complete FK verification); never edit applied migration 0022 in place. Retain existing MK99 rows, indexes and foreign keys.

## Required upcoming implementation

1. Build Xiaodou subscription order creation for purchase/renewal/upgrade with the same server-owned pricing, quote, concurrency, idempotency and order-in-flight guards as MK99. Set `merchant_provider='xiaodou'` in the trusted new storage, freeze RSA2 appId/kid identifiers and CNY totals. Never store the private key in D1. For an unchanged `outTradeNo`, do not vary `subject`, `amountFen`, `returnUrl` or other business-digest inputs. The original vendor `notifyUrl` is application-level portal config, **never** a field in the strict order body.
2. Integrate RSA2 requests, responses and webhooks per docs 03/05/09; sign original bytes (six request headers), verify only correctly signed results, unique `eventId` and state machine idempotency; do not use checkout-page return or Webhook appearance as paid fact. `UNKNOWN` never creates another order and never grants credits. Verify order identity, app, provider, channel and total before subscription settlement.
3. Implement subscription-only atomic D1-batch grant/renewal/upgrade, with a provider-specific query/notification boundary but no call to the credit-package `applyPaymentEvent()`. Existing MK99 settlement and original MK99 notices remain untouched and resolvable after switching. Historical Epay callback remains functioning.
4. Resolve Cloudflare Worker source-IP constraints with the platform's official permitted fixed-egress strategy; distinguish `OPEN_API_SOURCE_IP_REJECTED` platform-edge vs app whitelist from `details.reason`. Production currently lacks Xiaodou secrets; do not bypass the IP check to force payment.
5. Replace current admin 409 switch guard **only after** Xiaodou subscription settlement has end-to-end local and Staging acceptance, channel/tradeScope release, callback registration and signed readback. Global switch should atomically affect new credit and subscription checkouts, with safe no-fallback and a single readable readiness report.
6. Confirm CNY pricing semantics with Xiaodou: default `SELLER` requires `amountFen`; optional `BUYER` requires `merchantAmountFen` and changes the buyer total. Do not migrate pricing silently or hard-code platform fees; reconcile from each order's `feeProjection`.

## Acceptance tests

- MK99→Xiaodou→MK99 across both product families; simultaneous switch and create operations; no cross-merchant checkout/reuse; old pending orders settled by original provider after switch.
- Xiaodou Alipay: purchase, renewal and tier upgrade; verified signed query and webhook, duplicate/late/reordered notifications, UNKNOWN, 403 and 409, financial mismatch/feeProjection, refund and reconciliation.
- WeChat remains unselectable; Epay never opens a new order although old signed callbacks are accepted; no payment secrets or buyer PII in logs.
- CI/build tests pass and Staging live checks are individually approved before any rollout. This WIP PR **must not be merged or deployed** as full functionality.
