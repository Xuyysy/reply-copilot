# MK99 Payment Integration Plan

> Implementation remains gated on confirming the protocol details listed below with MK99. This plan records the public documentation review and a compatible implementation path; it does not authorize payment calls or deployment.

**Goal:** Add MK99 as an independent payment provider while preserving existing Xiaodou RSA2/Epay orders, callbacks, and credit accounting.

**Architecture:** Add a server-side MK99 adapter for signed create/query operations and a distinct signed notification route. Extend the existing provider/channel policy and checkout contract so a payment choice is identified by both provider and channel. Store an immutable provider/channel snapshot per transaction and reuse the existing order and credit-ledger path after strict verification.

**Tech Stack:** Cloudflare Workers, TypeScript, D1/SQLite, Astro checkout, React admin console, Node test runner with mocked fetch and local D1 fixtures.

**Spec:** User request in the conversation, plus the public MK99 API documentation at https://mk99.cn/docs.

## Verified Documentation Facts

- The documentation page identifies `https://mk99.cn` as the production API base and lists a demo page, but does not document a sandbox API base.
- Requests use `application/x-www-form-urlencoded`; responses are JSON. API success is `code=1`; failure is `code=0` with `msg`.
- The documented signing choices are MD5 and RSA. MD5 sorts non-empty parameters by ASCII name, excludes `sign`/`sign_type`, appends `&key=<merchant key>`, then uses uppercase MD5. RSA sorts non-empty parameters, signs the URL-encoded key/value string with SHA256WithRSA, and Base64-encodes the signature.
- Order creation is `POST /openapi/pay/create`. Required fields include `pid`, `out_trade_no`, `total_amount` in yuan, `subject`, `paytype_code`, `notify_url`, `client_ip`, `timestamp`, `sign_type`, and `sign`. `channel_id`, `return_url`, and `attach` are optional. The example response contains `trade_no`, `out_trade_no`, and `pay_url`.
- Query is `POST /openapi/pay/query`, selecting either `trade_no` or `out_trade_no`, plus `pid`, `timestamp`, `sign_type`, and `sign`. Documented states include `WAIT_BUYER_PAY`, `TRADE_SUCCESS`, `TRADE_CLOSED`, `TRADE_REFUND`, `TRADE_FREEZE`, and `TRADE_UNFREEZE`; only `TRADE_SUCCESS` is described as payment success.
- Refund is `POST /openapi/pay/refund`, selecting `trade_no` or `out_trade_no`, with `refund_amount`, optional `refund_reason`, timestamp and signature. The example response reports `refund_status=SUCCESS`.
- The callback is POST to `notify_url`; the page says return the exact body `success` to acknowledge. Its form fields include merchant/order identifiers, amount, payment type, channel, status, timestamp, `sign_type`, and `sign`. Refund fields are documented for `TRADE_REFUND`; freeze/unfreeze status notifications use the same callback shape.
- The public payment-type list includes `alipay`, `wxpay`, `qqpay`, `bank`, `jdpay`, `unionpay`, `usdt`, `paypal`, and `douyinpay`. This list does not establish that a specific merchant account is enabled for every type.

## Unresolved Before Real Provider Calls

- Merchant-console enabled channels and channel-specific eligibility for the Reply Copilot service.
- Whether MK99 supports a dedicated sandbox/test merchant and test endpoint. The public docs only identify the production endpoint; the demo link is not documented as an API sandbox.
- Currency/settlement currency, fee rates, limits, settlement schedule, and any minimum/maximum amounts. The API calls the amount “yuan” but has no currency field.
- The exact callback canonicalization rules for each signature type and, for RSA notifications, which public key is used to verify the platform signature. The docs show request signing and callback signature fields but do not fully define the callback key exchange/verification procedure.
- Whether API responses are signed or whether TLS plus the authenticated request is the intended trust model.
- Callback retry behavior, timestamp validity window, stable event identifier, and whether retries preserve an identical notification body. The callback schema has no explicit event ID.
- Whether the returned `pay_url` domain set is fixed and how desktop QR/WeChat H5 presentation should work. The create response documents `pay_url`, not a QR field.
- Refund partial limits, duplicate-refund idempotency keys, refund callback semantics, and how refund notifications correlate to an individual refund request.
- Any merchant IP allowlist or source-IP requirements.

## Current Repository Fit

- `payment-policy.ts` currently models providers as `xiaodou` and `xiaodou_epay`; channels are `ALIPAY_H5` and `WECHAT_H5`. The MK99 channel codes and actual merchant availability need an explicit mapping, not assumptions based on channel names.
- `payments.ts` owns order creation, authenticated order reads, provider-specific notification handlers, and the shared D1 credit application path. New callbacks must use a separate route/parser/signature verifier and then call the existing atomic payment-event/credit path.
- Current schema constrains `payment_transactions.provider` and `provider_payment_events.provider` to `xiaodou`/`local_mock`; `payment_protocol` allows `rsa2`/`epay`. A distinct MK99 identity therefore needs an additive forward migration (next unused number: `0016`) and a compatibility strategy for the constrained columns. No existing migration should be edited or replayed.
- `checkout.astro` currently deduplicates methods by `channel` and sends only `channel` when creating an order. With multiple providers offering the same channel, this can display the wrong provider or route to a different one. The UI/API contract must identify the pair `(provider, channel)` and server-side validate it against current policy.
- The admin payment panel and `admin-controls.ts` currently manage RSA2/Epay settings with audited D1 updates. MK99 should receive an independent provider switch, provider-scoped channel switches, credential readiness, and explicit account/channel availability. Defaults should be inserted only when absent; never infer channel approval from another provider or from a public channel list.

## Proposed Implementation Stages

1. **Resolve protocol/account facts:** obtain merchant-console confirmation and official SDK examples for callback verification, RSA notification key, response trust, event idempotency/retries, sandbox, channel permissions, currency, fees, and limits. Keep production payment disabled.
2. **Schema and policy:** add forward-only migration `0016` for explicit MK99 adapter/provider identity and event namespace. Preserve all existing row IDs, provider/protocol snapshots, event records, attempts, and settings. Add missing-only defaults for MK99 controls. Add tests that old RSA2/Epay routes and historical notifications are unchanged.
3. **Adapter:** add a dedicated server-only `mk99` client module. Implement deterministic form encoding/signature generation according to the confirmed MD5 or RSA mode, signed query, create response validation, safe pay URL validation, timeout/unknown classification, and callback verification. Never put the merchant key in browser payloads or logs.
4. **Shared order integration:** snapshot provider/channel on transaction creation; validate the selected provider/channel pair server-side; reuse the existing order ownership, amount snapshot, event idempotency and D1 credit batch logic. No success credit from `return_url`. Unknown network outcomes remain unresolved and cannot be blindly recreated.
5. **Admin and checkout:** add audited MK99 provider/channel controls; show only merchant-enabled and configured methods. Checkout keys each choice by `(provider, channel)` and sends both; server rejects stale/disabled combinations. Preserve the existing Xiaodou order routes and historical callback behavior.
6. **Verification:** mock canonical signatures for MD5 and RSA independently; test malformed/missing fields, invalid signatures, wrong merchant/order/amount/currency, duplicate and reordered notifications, callback acknowledgements, refund/freeze states, provider/channel collisions, timeouts, no-link responses, and migration preservation. Run all API tests, typecheck, web build, and Staging config checks.
7. **Staging rollout:** configure credentials only as Worker Secrets, apply the forward migration after a verified backup, deploy Worker and Pages compatibly, and first perform non-transactional read-only checks if MK99 documents a safe signed endpoint. Do not create a real order until the merchant confirms a test/sandbox plan and the user separately chooses a live-payment test.

## Review Focus

- Same channel exposed by Xiaodou and MK99 must retain provider identity from UI selection through D1 snapshot and callback routing.
- Unknown create result must not produce a second live payment order without reconciliation.
- Notification signatures must be verified with the correct key and exact provider canonicalization before any order/credit write.
- Missing currency in callback must be handled only under a confirmed merchant settlement contract; explicit conflict must fail closed.
- Freeze/unfreeze and refund notifications must not release or revoke credits incorrectly; unresolved semantics should enter manual review.
- The 0016 migration must leave every pre-existing payment transaction, event, refund, order, credit batch, setting, and audit row unchanged unless a narrowly documented default is inserted.

## Implementation update

Static inspection of the official PHP SDK subsequently confirmed RSA notification verification with the platform public key and identical decoded-form canonicalization. The portal's combined-mode behavior and buyer-paid fee semantics are still unconfirmed. The implementation therefore defaults to explicit RSA/RSA and gates live use behind protocol and exact CNY buyer-total confirmation. Migration0016 uses additive merchant identity columns instead of rebuilding constrained historical tables. See `docs/payments/mk99-operations.md` for the implemented routing, risk policy, credential setup and operational limitations.
