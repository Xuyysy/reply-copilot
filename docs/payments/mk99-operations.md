# MK99 integration and merchant switching

Baseline: baf108cb1438f24e0a2c8ea8e5efb451beb7de94. Official sources read: https://mk99.cn/docs and the public https://mk99.cn/sdk/php.zip (static inspection only).

## Implemented contract

- `active_merchant` in D1 chooses `xiaodou`, `mk99`, or `none`. The global purchase switch and environment safety ceiling remain independent. MK99 never falls back to Xiaodou. Existing transactions keep their own immutable merchant identity regardless of new-sales settings.
- Checkout preserves the `(provider, channel)` pair and the server validates it again. The D1 order insert repeats merchant, purchase, interface, channel and release checks atomically. Old Xiaodou clients omitting provider remain compatible only while Xiaodou is selected.
- MK99 signs form POST requests to fixed HTTPS endpoints. Request mode and expected notification mode are explicit; a callback cannot downgrade the configured mode. MD5 is uppercase over the sorted decoded parameter string plus `&key=...`. RSA is RSASSA-PKCS1-v1_5/SHA-256. Native Workers fetch is called without a receiver, with manual redirects, bounded bodies, one timeout and no retry.
- The PHP SDK confirms `verifyNotify` uses the platform public key for RSA and the merchant shared key for MD5. Its request code does not verify a separate API response signature. Our client requires the fixed trusted HTTPS origin, verifies TLS through Workers, forbids redirects, validates JSON/envelope/order/amount, and does NOT copy the SDK's disabled TLS certificate verification.
- The portal's "MD5+RSA" option does not document a third cryptographic algorithm or prove both directions are configured. Recommended target: RSA requests plus RSA notifications after merchant public-key registration. An explicitly configured MD5 mode is supported, but only after confirming the actual notification mode. No automatic algorithm negotiation.
- `POST /v1/payments/mk99/notify` is separate from both Xiaodou notification handlers. It requires a valid configured signature and exact merchant, order, trade ID, pay type and amount match. A successful atomic write or exact duplicate is acknowledged with `success`. New-sales switches do not disable existing MK99 notifications or owned queries.
- Only confirmed CNY exact-buyer-total semantics are currently implemented. `total_amount` must equal the immutable local total. This contract must NOT be selected if MK99 adds another buyer fee or reports merchant receivable instead. Such behavior requires confirmed fields/rules and a follow-up amount adapter before enabling real payment.
- Product principal, existing customer service fee, total requested and actual paid have separate fields. Actual paid is recorded only after trusted success. Provider fee and merchant settlement stay NULL because the public API does not document those fields. No invented platform fee projection.
- Payment success uses an MK99-prefixed stable event key plus the existing unique order ledger/batch and atomic assertions. Query/notification races cannot grant twice. Network uncertainty retains the local UNKNOWN order and blocks blind recreation.
- Query risk event digests are synthetic transaction/status identities, not a signed response body. The event source distinguishes them from signed notifications. Freeze, unfreeze and refund notifications/queries create an append-only `mk99_risk_events` record and set the corresponding purchased batch to manual review. Its unused credits are unavailable; original principal balance and consumption history are not rewritten. Unfreeze requires manual review, not automatic credit restoration. No real refund method is exposed.
- Automatic browser monitoring reads only local order state and refreshes quota after server `paid` plus `creditedAt`. An explicit owner refresh calls the provider query once. Return navigation never grants credits.

## Migration 0016

No existing table is dropped, renamed or rebuilt. No old migration is edited. The constrained old `provider`/`payment_protocol` columns are retained as legacy storage namespaces. The new `merchant_provider` column is authoritative for dispatch and notification isolation; MK99 rows are never inferred from the legacy namespace. Public responses, admin reports and activity show MK99 correctly. Every MK99 event is explicitly tagged and uses an `mk99:` event ID namespace. Existing Xiaodou callback selectors require `merchant_provider='xiaodou'`.

New fields snapshot the merchant account, notification mode, requested amount, amount contract, platform trade ID, observed actual paid amount, provider fee/settlement where known, and risk status. Defaults add MK99 closed/unconfirmed and preserve existing merchant sales behavior; settings use missing-only initialization. Existing row values, indexes, foreign keys and credit records are verified by migration tests. Production is not migrated by this work.

## Credentials and prerequisites

1. Rotate the previously exposed MK99 MD5 key in the merchant portal and invalidate the old one, even if RSA is used for this application. Do not paste it in chat or source.
2. Confirm allowed `alipay`/`wxpay` channels for this merchant and the AI service business, real cashier origins, currency, and whether buyer-paid fees are included in or added to `total_amount`. Do not infer approval from the public list.
3. Generate a fresh merchant RSA key pair locally (example directory is controlled by the user):

```sh
umask 077
mkdir -p "$HOME/.config/reply-copilot/mk99"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$HOME/.config/reply-copilot/mk99/merchant-private.pem"
openssl pkey -in "$HOME/.config/reply-copilot/mk99/merchant-private.pem" -pubout -out "$HOME/.config/reply-copilot/mk99/merchant-public.pem"
```

Register only the public key in the merchant portal. Obtain the platform public key from that portal and independently confirm its fingerprint/source. Never upload the private key to the portal or commit it.

4. Secret names (values entered in local trusted terminal or Cloudflare UI): `MK99_PID`, `MK99_PRIVATE_KEY`, `MK99_PLATFORM_PUBLIC_KEY`; `MK99_KEY` only if MD5 is chosen. Example secure private-key upload:

```sh
cd '/Users/xuyaoyang/x posst/apps/reply-copilot/api'
npx --no-install wrangler secret put MK99_PRIVATE_KEY --env staging < "$HOME/.config/reply-copilot/mk99/merchant-private.pem"
```

5. Server configuration (no defaults grant actual approval): `MK99_REQUEST_SIGN_TYPE` and `MK99_NOTIFY_SIGN_TYPE` (`RSA` defaults, or explicit `MD5`); `MK99_BASE_URL` (fixed official root); `MK99_CASHIER_ORIGINS` (comma-separated approved HTTPS origins). Set `MK99_PROTOCOL_CONFIRMED=1` only after both directions are verified against the actual account. Set `MK99_AMOUNT_CONTRACT=CNY_EXACT_BUYER_TOTAL` only when the provider confirms these exact semantics. These flags remain absent/closed for this rollout.
6. Staging callback: `https://api-staging.x-reply-helper.top/v1/payments/mk99/notify`. Per-order return URL is built on the trusted web origin with a local order locator. No payment fields are taken from that navigation as proof.
7. Admin may select MK99, enable its interface and separately confirm/enable channels. Until the server credentials and contracts are ready, methods remain unavailable with reasons. The API connectivity button is a signed balance query, not a channel-approval test; this development never invokes it against MK99.

## Verification and rollback

Automated tests use only fake merchants/keys and mocked outbound fetch, plus a native workerd test with a fully replaced outbound service. Tests cover signature canonicalization, algorithm downgrade, merchant switching, missing readiness, unknown/network handling, matching, query/callback races, closed/freeze concurrency, administrative audit/auth/CSRF, and migration preservation.

Staging rollout order: verified DB backup -> migration0016 -> Worker -> Pages -> health/packages and read-only data comparison. Backup restoration is an emergency operation requiring separate review. Ordinary rollback restores prior Worker/Pages versions; 0016 remains safely additive and is not reversed. Never replay or delete financial records.
