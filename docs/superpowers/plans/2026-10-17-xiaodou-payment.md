# x-Reply-Helper Xiaodou Payment Plan

## Goal and constraints
Implement an additive local payment lifecycle for CNY top-ups, a local-only Mock cashier, and a disabled-by-default Xiaodou RSA2 provider. Never call live payment APIs, deploy Cloudflare, alter production, or touch Auto Poster. Preserve old USD orders and account/credit data. Fixed package prices are owner-approved: USD reference $1.49/$2.99/$4.99 and CNY settlement 990/1990/3290 fen.

## Global constraints
- Only this repository and `codex/v0.4-credits`.
- No remote migrations, deployment, DNS, real payment calls, real credentials, or production changes.
- Package ID and credit counts remain stable; migration updates only current package prices and adds CNY fen. Historic order snapshots remain untouched.
- Additive migrations only; local D1 tests use temporary databases.
- Real checkout is disabled unless explicitly configured and never enabled in checked-in Staging/Production config.

## Task 1: Additive payment schema
**Files:** `api/migrations/0005_xiaodou_payments.sql`, schema/local migration tests.
**Steps:**
1. Write a migration test asserting legacy orders remain USD, package CNY price is nullable, and provider transaction/attempt/refund/event data have uniqueness and valid status constraints.
2. Run it against a fresh local SQLite database and observe failure.
3. Add an additive migration: `price_cny_fen` to packages; one payment transaction per order with provider, CNY amount, state including UNKNOWN, provider trade id; immutable attempts with stable request id and attempt number; refunds with idempotent refund id and amount; verified-event dedupe table. Do not change old rows.
4. Re-run local migration test and verify existing migrations apply unchanged.
**Expected:** migration applies locally; old USD rows and balances are unchanged; uniqueness rejects duplicate order/refund/event ids.

## Task 2: RSA2 provider protocol
**Files:** new `api/src/xiaodou.ts`, `api/tests/xiaodou.test.mjs`.
**Steps:**
1. Write tests first for request canonicalization/signing, raw-body response and webhook verification, key-id rejection, malformed signature headers, and fake-fetch create/query/relaunch/refund calls.
2. Run tests and observe missing module failures.
3. Implement WebCrypto RSA-SHA256 with PKCS#8 merchant private key and configured pinned platform public keys. Inject fetch; never log credentials or payloads. Keep endpoints and base URL configurable and require HTTPS.
4. Re-run tests including signature tampering, response status failures and no network when tests use the fake fetch.
**Expected:** valid RSA2 fixtures verify, altered bytes/signatures fail, methods call only injected fake provider in tests.

## Task 3: API payment lifecycle
**Files:** `api/src/commercial.ts`, `api/src/index.ts`, `api/src/types.ts`, local D1 e2e tests, Worker config.
**Steps:**
1. Add tests for local mock order create, unpaid state, valid settlement, replay, amount mismatch, concurrent settlement, late success, status reconciliation, and partial/full refund bookkeeping; assert credits and ledger remain exact.
2. Run the relevant test and observe missing endpoints/schema behavior.
3. Implement local Mock-only cashier paths behind development + loopback checks; secure owner actions with web session and CSRF. Real create/query/relaunch/refund use injected provider with default-off feature flags and server-priced `price_cny_fen`; require matching order amount/currency/owner. Persist outgoing request identity before remote I/O and retain UNKNOWN without blind new payment requests. Webhooks verify raw body before parse, then atomically dedupe event + transition order + grant one credit ledger entry. Only verified provider success can grant; late success after close/failure may settle; UNKNOWN does not imply failure. Add refund records and reverse paid balance once using a new explicit ledger kind via compatible schema strategy.
4. Run local E2E and API typecheck.
**Expected:** mock end-to-end grants exactly package credits once; all real routes disabled by default; webhook invalid/unverified payload never mutates state.

## Task 4: Website checkout and full verification
**Files:** `web/src/pages/pricing.astro`, `web/src/pages/checkout.astro`, minimal UI tests, API e2e as needed.
**Steps:**
1. Add page tests for server-sourced CNY price, disabled real checkout, local mock status display, and no client-supplied amount.
2. The initial checkout was preview-only; tests now cover the completed local Mock flow.
3. Implement local Mock checkout interactions (create, view pending, simulate local payment, refresh balance) and real checkout display only when server advertises availability. Use provider cashier URL from server, never store secrets or claim payment from return URL alone.
4. Run website build, all API/browser-independent tests, API typecheck, and Staging safety check. Inspect diff for accidental secret/config leakage and ensure Staging stays AI_MODE=mock, payment disabled.
**Expected:** local flow is operable; generated website builds; existing AI and account behavior passes.

## Interfaces
Task 1 produces transaction/attempt/refund/event tables consumed by Tasks 2 and 3. Task 2 produces provider adapter consumed by Task 3. Task 3 adds endpoints consumed by Task 4. Tests use fake provider and local SQLite only.

## Review focus
Atomic credit grant and event dedupe under concurrent callbacks; do not trust browser payment claims outside local Mock; response and webhook signatures use raw bytes and pinned key IDs; real payments remain disabled in all checked-in environments; no secret leakage; preserve legacy USD rows and existing balances.

## Completion status
- [x] Additive migration and legacy order snapshot coverage.
- [x] Xiaodou RSA-SHA256 adapter with fake-fetch signature, webhook, status, and error tests.
- [x] Worker order lifecycle, local-only Mock, idempotent paid credit grant, and refund reservation/reversal.
- [x] Prevent a second open order while a prior payment remains pending or unknown.
- [x] Pricing and checkout use server-sourced package ID, fixed USD reference prices, and fixed CNY settlement prices.
- [x] API typecheck, API tests, local Worker/D1 E2E, Chrome browser smoke, website build/tests, and Staging config check.
- [ ] Real Xiaodou credentials/Sandbox or controlled merchant integration test. Live payments remain disabled pending separate authorization.
