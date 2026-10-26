# Xiaodou Epay: local integration (2026-10-21)

## Scope and protocol

This is an additive adapter for the official Epay compatibility protocol, not a
replacement for the RSA2 Open API. Sources: the user-provided published
`XD-OP-13` v1.0.0, and the public compatibility/signing-tool pages:

- https://xdfair.cn/compatibility/epay/
- https://xdfair.cn/tools/epay-sign/

No real credentials are required for the Mock tests. No provider API call,
transaction, deployment, remote migration, commit or push is part of this work.

## Flow

1. Authenticated/CSRF-protected `POST /v1/orders` reads the server package and
   freezes the existing principal, customer fee, total and credit snapshots.
2. With `PAYMENT_PROVIDER=xiaodou_epay`, Worker signs a server-configured POST
   form for `submit.php`. There is **no Worker-to-provider fetch**.
3. The checkout page shows CNY principal/fee/total and the existing refund terms.
   A separate explicit customer click submits DOM-built hidden inputs. The Key
   is never returned, persisted in orders or copied into the web build.
4. `GET /v1/payments/xiaodou/epay/notify` checks the MD5 signature, merchant PID,
   local order/protocol/PID snapshot, CNY amount, `type=alipay` when supplied (otherwise the frozen Alipay contract), platform trade
   reference and `trade_status=TRADE_SUCCESS` before settlement.
5. Settlement reuses the existing D1 atomic credit-account/ledger/batch operation.
   Epay-only assertions bind a unique platform trade reference in the **same
   batch**. Duplicate callbacks cannot grant a second purchase batch. A failed
   financial write rolls back the binding, event, status and balance together.
6. Successful notifications receive HTTP 200 and body exactly `success`.
   `return_url` goes to the website account page and has no settlement handler.

A prepared form is **not** evidence that the platform accepted an order.

## Configuration (future approved Staging setup)

Three new server-side Secrets:

- `XIAODOU_EPAY_GATEWAY`: official HTTPS root gateway or full `/submit.php` URL.
  Query strings, fragments, credentials and other endpoint paths are rejected.
- `XIAODOU_EPAY_PID`: the Epay merchant PID (not the RSA2 App ID or key ID).
- `XIAODOU_EPAY_KEY`: the Epay shared signing Key (not the RSA private key).

Use interactive `wrangler secret put <NAME> --env staging` only in a separately
approved configuration step. Do not put values in arguments, documentation,
Git, client variables or chat. Keep all existing Secrets unchanged.

After a separate deployment approval, select `PAYMENT_PROVIDER=xiaodou_epay` in
the Staging environment. Keep `PAYMENTS_ENABLED=0` initially. The existing
`XIAODOU_WEBHOOKS_ENABLED=1` controls notification acceptance independently of
new checkout availability. RSA2 Webhooks remain valid when Epay is selected,
and existing Epay notifications remain valid when RSA2 is reselected.

**The repository configuration remains RSA2-selected and payments disabled.**

Notify URL for Staging:

`https://api-staging.x-reply-helper.top/v1/payments/xiaodou/epay/notify`

Return URL:

`https://staging.x-reply-helper.top/account/`

Keep Staging automatic invocation logging disabled and query-string redaction
in place: signed GET notification URLs must not be logged as raw request URLs.

## Migration and compatibility

`0010_xiaodou_epay.sql` adds protocol/PID/platform-trade metadata and a unique
platform-reference index. All existing transactions default to `rsa2`; their
amounts, states, UNKNOWN handling, accounts, batches and ledger are untouched.
Apply 0010 **before** deploying the new Worker. It has been tested only locally;
no remote migration is authorized by this implementation task.

Epay does not supply RSA2 `feeProjection`: its projection status is explicitly
`not_applicable`, not `verified`. Actual provider settlement fees require merchant
statement reconciliation; customer-facing fee snapshots stay unchanged.

No undocumented `api.php` response authentication is guessed. Epay order refresh
returns `verificationSource=local_only`, and the UI labels it as local record
refresh. No new upstream call, payment attempt or grant occurs during refresh.
Old RSA2 queries keep their original verified-query behavior.

Epay refunds are manual at this stage, per the protocol's lack of a refund API.
The account UI marks them for manual handling, and the API returns
`REFUND_MANUAL_REVIEW_REQUIRED` **before** freezing credits or creating refunds.
Do not invoke RSA2 refunds for Epay transactions. A future audited manual refund
reconciliation flow must confirm actual refund success before revoking the
corresponding unused credits; ordinary unused-package and fee rules still apply.

The initial form is held in checkout page memory. After navigation/reload, the
account page links to `/checkout/?order=<owned-order-id>`. When checkout is enabled,
an explicit restore action uses the existing authenticated/CSRF-protected
`POST /v1/orders/:id/attempts` route to rebuild the **same** order form, with the
original amount/credits/PID snapshot. It performs no upstream request and creates
no new order or payment-attempt row. Restoring never auto-submits the form. A
second explicit customer click is needed to navigate to the cashier. Recovery is
blocked for paid/non-pending orders, changed merchant PID or disabled checkout.
Do not repeatedly submit on gateway errors or UNKNOWN outcomes. Browser Back
resets transient busy controls. Existing unresolved-order guards remain in place,
including for the two historical UNKNOWN orders.

## First manual cashier validation (requires separate approval)

1. Back up Staging D1; approve/apply 0010; configure the three Secrets; deploy
   coordinated Worker and Pages versions. Preserve all RSA2 credentials and
   historical orders. Verify payments remain off and both callback routes are
   isolated. Do not send forged success notifications to the online account.
2. Choose a test account with no unresolved order; never rewrite old UNKNOWN
   records to make checkout available. Record balances and purchase-ledger counts.
3. Explicitly approve a private Staging checkout window. Keep PAYMENTS_ENABLED=0;
   safely set STAGING_PAYMENT_TEST_USER_EMAIL as a Secret and enable
   STAGING_PAYMENT_TEST_ENABLED=1 through the full Staging config. Only the
   authenticated matching web session can create/recover an Epay form. Keep
   Webhook on, AI mock and admin off; anonymous/other accounts remain unavailable.
4. User selects the 400-credit package: CNY 9.90 + 0.16 = 10.06, USD reference 1.49.
   Create **one local order**, inspect the displayed total, then manually click
   the Epay form button once. This browser submission can create a real unpaid
   platform order even if the user does not pay; it is not a dry-run.
5. Stop on a gateway error, amount discrepancy or unknown result. Do not retry or
   make another order. Close new checkout promptly; retain notifications and keys.
6. Entering the cashier does not grant credits. Actual payment remains the user's
   action under separate authorization. After payment, verify a matching signed
   GET notify, one paid order, one 400-credit batch, one purchase-grant ledger row,
   unchanged free balance and exact-once crediting. A return-page visit is not proof.

Rollback to RSA2 selection/payments-off must retain 0010 and Epay notification
credentials for late valid notifications. Do not roll back/drop the database.

## Files and verified local results

New production files:
- `api/src/epay.js`
- `api/migrations/0010_xiaodou_epay.sql`
- `web/src/lib/epay-form.mjs`

Incremental integration in existing files (prior V2 changes retained):
- `api/src/payments.ts`, `api/src/index.ts`, `api/src/types.ts`
- `api/src/account.ts`, `api/src/xiaodou.js`, `api/scripts/check-environment.mjs`
- `web/src/pages/checkout.astro`, `web/src/lib/checkout-status.mjs`
- `web/src/components/account/AccountDashboard.tsx`

New tests: `api/tests/epay.test.mjs`, `epay-http.test.mjs`,
`epay-migration.test.mjs`, `epay-workers-runtime.test.mjs`,
`epay-browser-api.test.mjs`, `epay-checkout-ui.test.mjs`,
`web/tests/epay-form.test.mjs`; added coverage in
`web/tests/checkout-status.test.mjs`.

Final full suite: 300 tests passed, zero failed. API typecheck, Staging safe-default
check, Staging website build, Worker dry-run and isolated local D1/Worker E2E pass.
The latter retains signup 200, five successful generations to 195, exact-once
Mock purchase/refund and existing safety checks. Epay tests additionally prove
no provider fetch during form creation/restoration, zero writes on invalid
notifications, atomic rollback on ledger failure, cross-order trade-reference
uniqueness, owner/CSRF/off-switch protections and historical migration safety.
The actual checkout script is exercised with Mock DOM/fetch for navigation,
manual recovery, no automatic submission, and restored-button behavior.

Independent read-only review found form recovery and browser-return control
issues; both were fixed with regressions. No real browser cashier acceptance,
real payment, real callback or gateway availability is claimed by these tests.

## Private Staging checkout readiness (2026-10-21)

`STAGING_PAYMENT_TEST_ENABLED` defaults to `0` and is rejected by the safe-default
check if enabled. A later separately approved private test requires the
`STAGING_PAYMENT_TEST_USER_EMAIL` Secret, `ENVIRONMENT=staging`,
`PAYMENT_PROVIDER=xiaodou_epay`, and `PAYMENTS_ENABLED=0`. The email is compared
with the authenticated server-side web session, never a client-supplied field.
The package endpoint returns personalized availability with `Cache-Control: no-store`;
unauthenticated and nonmatching accounts stay closed. CSRF and order ownership
protections remain mandatory for create/form recovery. Conflicting public/private
enable flags fail closed; RSA2 relaunch/refund cannot bypass private mode. Existing
notifications and trusted queries remain independent. Closing the private switch
must never block a late valid notification.

Configure the account in the API directory using interactive hidden input:
`npx --no-install wrangler secret put STAGING_PAYMENT_TEST_USER_EMAIL --env staging`.
Never paste the email or any secret into chat, tracked configuration, or build
variables. This deployment leaves the test switch at `0`; setting the account and
activating a later test window require the user's next explicit authorization.

Fresh verification after the gate: 312 full-project tests passed, zero failures;
API typecheck, Staging configuration check, and Staging Worker dry-run passed.
Tests include account/anonymous/CSRF denials, client identity spoofing, Production
isolation, conflicting flags, RSA2 relaunch denial, and late notification delivery
after private mode closes. All provider interactions in tests are Mock only.

## Staging non-transaction deployment result (2026-10-21)

- Migration 0010 applied exactly once to Staging D1 UUID
  `cd44bb44-b525-42c4-b286-2cc84dae7fdb`; 0001–0010 registered.
- Worker code release `9164cd81-4115-4ad3-8f81-d5a2092caa2c` was verified at
  100%. After the user safely added the account Secret, the active version became
  `f33adc7b-73b6-4607-8842-2061da4eda7c` at 100%.
- Staging Pages release `aeeff0d5-ed69-4d96-9915-c0c7bc1ba8af`; live checkout
  and account HTML exactly match the Staging build.
- All 16 Secret names exist, including the three Epay credentials and test-account
  email. Values were not retrieved or printed; provider-side validity is not
  claimed. Original 15 Secret bindings were preserved.
- PAYMENTS_ENABLED=0, STAGING_PAYMENT_TEST_ENABLED=0, WEBHOOKS=1, AI_MODE=mock,
  REAL_DEEPSEEK_TEST_ENABLED=0, ADMIN_PORTAL_ENABLED=0. D1 binding unchanged.
- Health/packages 200; public paymentAvailable=false; totals 1006/2021/3341 fen.
  Epay unsigned/invalid-signature and RSA2 unsigned notification checks return
  401. No valid success event was sent online.
- Comparing restored exports before migration and after deployment checked all
  original columns in 34 business tables: no changes. Two old orders, two payment
  attempts, zero payment events/refunds, 17 ledger rows, aggregate free credits386,
  paid credits0. Old transactions retain RSA2 protocol and no Epay references.
- No real provider API request, order, payment, refund, commit or push occurred.
  Production, DNS, domains, WAF and Auto Poster were not modified.
- Next step requires separate approval to enable only the private Staging test
  switch. Keep public payments0 and notify handling enabled. The designated
  account then uses /checkout/?package=starter, verifies principal CNY9.90 +
  fee0.16 = total10.06, creates one local order and manually submits the form once.
  Browser submission can create a real provider transaction; it was not tested
  during this deployment. Gateway/cashier and real notification acceptance remain
  pending that controlled test.

## Cross-channel checkout/restart correction (2026-10-21)

The unresolved-order insert guard previously covered every order of a user,
including old RSA2 UNKNOWN records. Epay now scopes its default duplicate guard
only to unresolved Epay orders. RSA2's existing guard remains unchanged. Neither
protocol's old order status is rewritten or cancelled.

The Epay create API additionally accepts `restartPayment: true` only as a boolean
and only for Epay. This explicit action creates a new UUID/out_trade_no and
retains the old payable order. Auth, CSRF, account gate and server prices still
apply. The UI shows “重新发起支付” for an unresolved order or duplicate-order error,
explains that old orders are not cancelled, disables double-clicks, and never
submits the resulting form automatically. Each genuinely paid order is settled
independently, exactly once. Do not pay multiple orders unintentionally.

No new migration is needed. Regression coverage includes cross-protocol
unblocking, new unique order numbers, explicit restart vs default duplicate
denial, invalid flag/CSRF/off-switch protection, independent late callbacks and
UI double-click/no-auto-submit behavior. Full project suite:317 tests passed.

### Staging restart rollout and cashier acceptance

- Restart fix Worker initially `bb01be9f-5eb6-4bc9-8aab-91433bd9c695`;
  Pages `19dd6058-886b-4690-9f98-b0bccc288ef4`. Live checkout HTML matches build.
- User confirmed entering the cashier with total CNY10.06. This is human-reported
  cashier acceptance, not a confirmed payment or signed success notification.
- Exactly one new Epay local order was observed: principal990 + fee16 =1006fen,
  order awaiting_payment, transaction pending. All preexisting rows remain exact;
  additions are one order, one transaction, one attempt only. Ledger17, events0,
  refunds0, aggregate free386 and paid0 remain unchanged. No migration was needed.
- After cashier entry, the private creation switch was restored to0 by deploying
  Worker `8da50eb2-5879-43cf-bc67-67795734f90b`; public payments remain0 and
  Webhook remains1. Existing cashier/late valid notifications remain available.
- No funds were paid by the agent; no valid success event was injected online.
  Actual user payment and exact-once 400-credit notification acceptance remain
  the next human-dependent validation step. No Git commit/push was performed.

## Automatic post-payment account synchronization (2026-10-21)

New signed return URLs contain the immutable local order locator. Account and
checkout read only authenticated local order state, at2.5s intervals for up to
120s active waiting; hidden/pagehide pauses, BFCache/focus resumes. Paid success
requires paid+creditedAt, then fresh account/quota data. A pre-confirmation
in-flight refresh is explicitly not reused for post-confirmation success.
The browser never grants credits, creates a new order, or queries the provider
in this polling loop. Duplicated components share a controller; visible tabs
coordinate a short-lived lease. Timers/listeners are disposed or paused correctly.
Provider return-signature fields are cleared from the visible account URL.

Final verification:331 full-project tests passed, API and web typechecks passed,
Staging check and Worker dry-run passed. Delayed payment, timeout, page hiding,
BFCache, coalesced tabs, stale account-refresh race, untrusted return parameters,
GET-only polling and no automatic submission have Mock coverage.

Worker `4ef01fba-b716-4438-8715-fc927ba56d3b` verified at100%.
Pages `1010c7e2-80e6-4f8e-b6d8-3b0d4f113bd8` canonical deployment succeeded;
live checkout/account HTML match the build. Health/packages200; payments false;
unsigned notify401. Payments0/private-test0, Webhook1, AI mock/admin0;16Secret
names and D1 unchanged. No migration, real payment, refund or Git commit/push.
Before/after restored D1 exports have the same SHA256; orders3, events1, ledger18,
free386 and paid400 unchanged. The four read-only accounting audit counts are0.
No new real-money browser payment was executed to validate this UI revision.

Production gaps and rollout prerequisites are recorded in
`docs/payments/production-readiness.md`; no Production resources were changed.
