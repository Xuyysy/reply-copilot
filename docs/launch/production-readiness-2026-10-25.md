# Production readiness — 2026-10-25

This is the current Production readiness record. Older launch documents are
historical and must not be used as execution checklists.

## Verified Production state

- Existing Cloudflare resources are Worker `reply-copilot-api-production`, Pages
  `x-reply-helper-production`, and D1 `reply-copilot-production`. Do not recreate
  them.
- Worker version `5a48f3e0-b8be-4cdb-b1c9-ef3c61657bde` serves 100% traffic.
  `api.x-reply-helper.top` is an active Worker custom domain; Production Pages
  serves `app.x-reply-helper.top`.
- Production D1 UUID is `d9df7d23-9b9c-44ac-a33a-c24474c15691`; migrations
  0001–0017 are already applied. A fresh read-only query confirmed the
  `d1_migrations` tracking table exists, and there are no users,
  orders, payment events, ledger rows, credit batches, or admin audit rows.
- Worker `/health` and `/v1/packages` returned HTTP 200. New purchases are closed
  (`PAYMENTS_ENABLED=0`, D1 `purchase_enabled=0`) and the admin portal is closed
  (`ADMIN_PORTAL_ENABLED=0`).
- Stable Chrome extension ID is `fgfjajofkapebgphfidblngcjomkbdaj`; the current
  Worker extension origin matches it.
- Read-only Cloudflare inspection on 2026-10-25 confirmed the existing
  Production Worker deployment still serves version
  `5a48f3e0-b8be-4cdb-b1c9-ef3c61657bde` at 100% traffic and the existing Pages
  project still serves `app.x-reply-helper.top`. The Direct Upload Pages
  project's saved environment-variable slots do not contain the build-time
  public API address or Turnstile Site Key; both must be injected into the
  Production build before a Pages upload.
- Production D1 read-only settings remain `purchase_enabled=0`,
  `active_merchant=xiaodou`, `payment_mk99_enabled=0`, AI enabled, and a
  `$1.00/UTC-day` cost limit. There are no administrator users or singleton
  administrator binding. `ADMIN_PORTAL_ENABLED=0` and `PAYMENTS_ENABLED=0`
  remain configured in the existing Worker.
- Current Production code is an older snapshot. A coordinated update from one
  reviewed commit is still needed under a separate release authorization.

## Credentials and configuration

### Existing Worker Secrets — presence only

Cloudflare lists `AUTH_HASH_SECRET`, `PASSWORD_PEPPER`, and
`TURNSTILE_SECRET_KEY`. Values were not read. Never read, rotate, or replace the
existing `PASSWORD_PEPPER`.

### Missing Production Worker Secrets

| Name | Purpose | Where to create and enter |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | Hosted AI | Reuse the already approved DeepSeek account/key. Enter it in the existing Production Worker’s Secret store or an interactive `wrangler secret put DEEPSEEK_API_KEY --env production` prompt during an authorized window; do not create or rotate a key for this task |
| `MAIL_API_KEY` | Verification and password-reset email | Reuse the existing Resend account/key after confirming it can send from the verified sender; enter it in the same Worker Secret store |
| `MK99_PID` | Production merchant identity | Obtain from the Production MK99 merchant account and enter in the Worker Secret store |
| `MK99_PRIVATE_KEY` | Signs MK99 API requests | Use the Production merchant keypair; enter only in the Worker Secret store |
| `MK99_PLATFORM_PUBLIC_KEY` | Verifies MK99 notifications | Obtain from the official Production merchant configuration; enter only in the Worker Secret store |

Never copy Staging values. Never put secrets in Git, chat, Pages variables,
URLs, command arguments, or logs. `MAIL_FROM` is absent from the Production
Worker and is a non-secret Worker variable; choose a sender on the existing
verified Production mail domain. Reuse existing DeepSeek and Resend account
keys; do not create or rotate keys for this release preparation.

### Public and non-secret settings

- Direct Upload Pages builds require
  `PUBLIC_API_BASE_URL=https://api.x-reply-helper.top` at build time. This is not
  a Worker variable and is not injected by Cloudflare Pages project settings in
  this Direct Upload setup.
- `PUBLIC_TURNSTILE_SITE_KEY` is public and is missing from the Pages project's
  saved Direct Upload environment slots. Reuse the existing Turnstile widget;
  verify it allows the exact Production hostname `app.x-reply-helper.top`, then
  provide its public Site Key to the Production Pages build. Verify that the
  existing `TURNSTILE_SECRET_KEY` is paired with that widget without exposing
  it. Do not create a replacement widget or deploy until the pair is verified.
- MK99 non-secret settings include `MK99_REQUEST_SIGN_TYPE=RSA`,
  `MK99_NOTIFY_SIGN_TYPE=RSA`, the confirmed API root, and approved cashier
  origins. Set `MK99_PROTOCOL_CONFIRMED=1` and
  `MK99_AMOUNT_CONTRACT=CNY_EXACT_BUYER_TOTAL` only after independently
  confirming Production request/notification signatures and buyer-paid amount
  semantics. None of the MK99 bindings are present in the current Production
  Worker. The API defaults `MK99_BASE_URL` to `https://mk99.cn` and request /
  notification signing types to RSA, but production approval flags and the
  cashier origin must be set and independently verified before paid sales.
  Staging confirmation does not transfer to Production. This is not a blocker
  for no-payment registration/AI launch while both purchase gates are off.
- Production currently has `AI_MODE=production`, model `deepseek-flash`, and
  configured rates $0.30/M input and $1.32/M output. The live DeepSeek docs list
  this model but its input/output rates vary by peak/off-peak schedule. The
  configured output rate is conservatively above the current listed peak price;
  this may reserve more budget than consumed but does not understate the peak
  price. Keep peak rates in the estimator unless a correct time-aware schedule
  is implemented. D1’s daily cost budget is $1.00 (1,000,000 micro-USD per UTC
  day). See [DeepSeek model and pricing documentation](https://api-docs.deepseek.com/quick_start/pricing/).
- `SITE_DAILY_CAP` is not read by the API request path. The effective AI budget
  is D1 `daily_cost_limit_micro_usd`; do not add a second competing cap.
- Worker `PAYMENT_PROVIDER` is currently `xiaodou`, but new-order merchant
  routing is controlled by D1 `active_merchant` and audited merchant/channel
  settings. After a Production administrator exists, switch new orders to MK99
  using the supported admin configuration. Keep both purchase gates closed
  during preparation. Historical notifications must continue using each
  order’s original provider.
- Legacy Xiaodou credentials are not required for a new MK99 merchant while
  Production has no Xiaodou transactions. Do not remove legacy support. If
  Production orders use that provider later, its provider-specific credentials
  are required to validate their callbacks/reconciliation.

## P0/P1 launch blockers

1. **P0 — registration and AI credentials:** the existing Production Worker
   lacks the DeepSeek and Resend API key bindings and `MAIL_FROM`. Reuse the
   existing provider accounts and verify the sender domain.
2. **P0 — Turnstile pairing:** the Worker Secret is present, but the Production
   Pages build Site Key is missing and its pairing with the existing widget has
   not been independently verified. Reuse the widget and confirm its allowed
   hostname is `app.x-reply-helper.top`.
3. **P0 for admin-console use — one-time admin bootstrap:** D1 has no users or admin. A local-only,
   fail-closed bootstrap tool is now prepared at
   [`../../tools/production-admin-bootstrap/README.md`](../../tools/production-admin-bootstrap/README.md).
   It has only been exercised against in-memory SQLite fixtures. It has not
   connected to or written Production. First complete registration and email
   verification, then review the candidate's stable user ID and expected email;
   actual Production execution needs separate explicit owner authorization.
4. **P0 — legal/support approval:** live privacy and terms pages visibly say
   “Draft”; privacy also says the account/data-request contact is pending. The
   operator must provide business identity, support/privacy contacts, retention
   and deletion process, and approve final terms/refund wording. Do not launch
   while these pages remain drafts.
5. **P1 — registration email:** verify the Production sender domain and test
   verification and password reset with purchases still closed.
6. **P1 — model cost schedule:** configure the existing DeepSeek key and align
   cost estimation with peak/off-peak prices; retain the $1/day database budget
   until the operator approves a different one.
7. **P1 for future paid sales — MK99 Production approval:** add independent
   Production merchant credentials and independently verify approved channels,
   cashier origins, buyer total/callback/query amount contract, notification
   URL, and official retry/support process. This does not block no-payment
   registration/AI deployment while purchases remain closed.
8. **P1 — Chrome Web Store:** the extension ID is stable, but the listing is not
   approved/published. Finish the permission rationale (including `debugger`),
   privacy questionnaire, screenshots, support contact, and submit only under a
   separate owner decision.

## Operator information needed

- Existing DeepSeek API key through the secure Worker Secret prompt and approval
  of the current cost policy; do not create or rotate a key.
- Existing Resend API key through the secure Worker Secret prompt, plus the
  verified sender address/domain to use as the non-secret `MAIL_FROM` Worker
  variable.
- Existing public Turnstile Site Key for `app.x-reply-helper.top`; verify the
  existing Worker secret belongs to the same widget.
- For future paid sales only: Production MK99 PID, merchant private key, platform
  public key, approved channels, official cashier origin, and explicit
  Production protocol/amount contract confirmation. Enter credentials only
  through the Worker Secret UI or interactive Wrangler prompt during the
  authorized window.
- Business/operator identity, public support/privacy contact, data retention
  and deletion policy, and final approval of privacy, terms, and refund copy.
- Create and email-verify the first Production account, then provide its stable
  user ID and the matching expected email through the local bootstrap tool at
  the separately authorized execution time. Do not send passwords, verification
  codes, or session tokens in chat.

## Release sequence (not authorized here)

1. Approve legal/support copy and prepare the independent Production values.
2. In a separately approved configuration window, add only missing Production
   Secrets and non-secret variables. Do not rotate `PASSWORD_PEPPER` or change
   purchase/admin switches.
3. From a reviewed commit, update the existing Worker and Pages; do not recreate
   resources or run D1 migrations. Verify API origin, health, auth, email,
   Turnstile, AI budget, extension origin, invalid-signature rejection, and
   closed purchase/admin switches.
4. Register and verify the first Production account, then perform the reviewed
   one-time stable-ID admin bootstrap. Enable the admin portal only after
   verifying that binding.
5. Keep purchases closed until the admin dashboard reports verified MK99
   channels. Separately authorize one human-funded Production acceptance order
   before opening public sales.
6. Submit the Chrome Web Store listing only after the Production build and
   privacy/legal disclosures are approved.

## Database backup/migration status

Production D1 0001–0017 is complete. A pre-migration backup plus isolated restore
and migration rehearsal was previously verified. This task performed only
read-only remote checks and did not create a new backup or run a migration.

## Current task boundary

The administrator bootstrap utility and local tests do not mean an administrator
has been created. Cloudflare checks in this task were read-only and confirmed
the existing resource identity, latest deployment metadata, Secret **names**,
Pages build-variable presence, closed payment/admin settings, empty business
data, and an empty foreign-key check. Secret values were not read. This task did
not write Production D1, change Production configuration, modify Staging, or
deploy.

The direct HTTP `/health` and `/v1/packages` smoke checks could not be repeated
from this execution environment because its network resolver could not resolve
the Production API hostname. Cloudflare resource/deployment/binding/D1 checks
did succeed; they are not a fresh HTTP API smoke test.
