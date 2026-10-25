# Production readiness — 2026-10-25

This is the current Production readiness record. Older launch documents are
historical and must not be used as execution checklists.

The release goal is one coordinated public launch with free features and MK99
paid purchases together. Staging acceptance is useful evidence, but does not
replace Production-specific verification. No Production writes or deployments
were authorized or performed in the 2026-10-25 Phase 1 review.

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
- Worker `/health` and `/v1/packages` previously returned HTTP 200. The 2026-10-25
  Phase 1 check verified Cloudflare deployment metadata and D1 directly, but
  did not repeat a fresh public HTTP smoke test from the Codex network because
  its resolver could not resolve the API hostname. New purchases are closed
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
- Production package rows are active with CNY principal values 990/1,990/3,290
  fen, USD display values 149/299/499 cents, and stored legacy `fee_rate_bps=150`.
  The current MK99 pricing tests confirm the merchant-borne 5% estimate ignores
  that legacy buyer-fee field and quotes 1,043/2,095/3,464 fen (¥10.43/¥20.95/
  ¥34.64), with zero extra buyer service fee. No package or order data was
  changed. Production D1 still selects Xiaodou, so this MK99 quote is only
  effective after the audited merchant setting is changed.
- The original Staging administrator remains the sole active, verified
  administrator there. Its identity was read-only confirmed (email kept
  masked); no Staging account data was copied. The owner intends to use the
  same email for a fresh Production registration, which will have a different
  Production user ID. The existing one-time bootstrap tool is the planned
  binding method after normal registration and email verification.
- Staging remains unchanged and currently has purchases open, MK99 selected,
  Alipay and WeChat enabled/released, and detailed MK99 diagnostics disabled.
  The Phase 1 review made no Staging changes.
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
| `DEEPSEEK_API_KEY` | Hosted AI | Reuse the existing DeepSeek account/key. Enter through Cloudflare Dashboard → Workers & Pages → `reply-copilot-api-production` → Settings → Variables and Secrets, during an authorized release window; do not create or rotate a key |
| `MAIL_API_KEY` | Verification and password-reset email | Reuse the existing Resend account/key after the sender identity is approved; enter through the same Production Worker Secret store |
| `MK99_PID` | Production merchant identity | Obtain from the Production MK99 merchant account and enter in the Worker Secret store |
| `MK99_PRIVATE_KEY` | Signs MK99 API requests | Use the Production merchant keypair; enter only in the Worker Secret store |
| `MK99_PLATFORM_PUBLIC_KEY` | Verifies MK99 notifications | Obtain from the official Production merchant configuration; enter only in the Worker Secret store |

Never copy Staging values. Never put secrets in Git, chat, Pages variables,
URLs, command arguments, or logs. `MAIL_FROM` is absent from the Production
Worker and is a non-secret Worker variable. Read-only Resend inspection found
one verified, sending-enabled domain, `mail-staging.x-reply-helper.top`, and no
verified Production-branded mail domain. The fast path is to reuse that
existing domain only if the operator explicitly approves the exact visible
sender address and accepts the `staging` label in Production mail. The
long-term path is to verify `mail.x-reply-helper.top` in the existing Resend
account. Do not create or rotate an API key. The Resend dashboard's Domains
page is the place to review domain status and the exact permitted sender.

### Public and non-secret settings

- Direct Upload Pages builds require
  `PUBLIC_API_BASE_URL=https://api.x-reply-helper.top` at build time. This is not
  a Worker variable and is not injected by Cloudflare Pages project settings in
  this Direct Upload setup. Build with `npm --prefix web run build:production`
  and inject both public values into that build. Do not deploy the local test
  Site Key used by earlier build checks.
- Cloudflare has an existing widget named `Reply Copilot Production
  Registration`, and read-only metadata confirms its allowed hostname is
  `app.x-reply-helper.top`; the widget has a public Site Key. Its value was not
  emitted in this audit. `PUBLIC_TURNSTILE_SITE_KEY` is absent from the Pages
  project's saved Direct Upload environment slots. Retrieve the public Site
  Key from that existing widget and inject it only at Production build time.
  The Worker `TURNSTILE_SECRET_KEY` is present but write-only; its pairing with
  this widget has not been independently proven. Do not overwrite it. The
  normal Production registration challenge is the safe end-to-end pairing
  check: a valid token accepted by the deployed Worker proves the pair. The
  first registration must be coordinated with the operator because it creates
  a pending account and sends an email. Do not create a replacement widget.
- MK99 non-secret settings include `MK99_REQUEST_SIGN_TYPE=RSA`,
  `MK99_NOTIFY_SIGN_TYPE=RSA`, the confirmed API root, and approved cashier
  origins. Set `MK99_PROTOCOL_CONFIRMED=1` and
  `MK99_AMOUNT_CONTRACT=CNY_EXACT_BUYER_TOTAL` only after independently
  confirming Production request/notification signatures and buyer-paid amount
  semantics. None of the MK99 bindings are present in the current Production
  Worker. The code defaults `MK99_BASE_URL` to `https://mk99.cn` and request /
  notification signing types to RSA, but the following must be explicitly
  supplied/verified for the Production merchant in the deployment config:
  `MK99_BASE_URL`, `MK99_CASHIER_ORIGINS`, `MK99_REQUEST_SIGN_TYPE=RSA`,
  `MK99_NOTIFY_SIGN_TYPE=RSA`, `MK99_PROTOCOL_CONFIRMED=1`, and
  `MK99_AMOUNT_CONTRACT=CNY_EXACT_BUYER_TOTAL`. Do not copy the Staging
  confirmations or infer channel approval from account activation.
  Staging confirmation does not transfer to Production. Because the agreed
  public launch includes paid purchases, these are full-launch blockers.
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
- Production is to launch with MK99 paid purchases in the same release as free
  features. The current Worker variable `PAYMENT_PROVIDER=xiaodou` is the
  legacy provider/runtime selector; new merchant selection is controlled by
  D1 `active_merchant` and the audited provider/channel settings. Keeping the
  legacy variable at `xiaodou` preserves the Xiaodou notification path and does
  not prevent MK99 selection. The actual current blocker is that Production D1
  still selects Xiaodou with MK99 disabled and there are no MK99 credentials or
  approvals. After the Production administrator is initialized, select MK99
  through the audited controls and its independently approved channels. Keep
  both purchase gates closed until the coordinated acceptance window.
  Historical notifications must continue using each order’s original provider.
- Legacy Xiaodou credentials are not required for a new MK99 merchant while
  Production has no Xiaodou transactions. Do not remove legacy support. If
  Production orders use that provider later, its provider-specific credentials
  are required to validate their callbacks/reconciliation.

## P0/P1 launch blockers

1. **P0 — real AI and registration mail:** the Production Worker lacks the
   DeepSeek and Resend API key bindings and `MAIL_FROM`. Reuse the existing
   accounts. The only currently verified Resend domain is branded `staging`;
   operator approval of that exact sender or verification of the production
   mail domain is required before sending registration mail.
2. **P0 — Turnstile build key and pairing:** the existing widget hostname is
   confirmed, but the Direct Upload Pages build lacks its Site Key and the
   write-only Worker Secret has not been proven to pair. Use the existing
   widget, inject its public key at build time, and verify the pair during the
   first authorized Production registration.
3. **P0 — MK99 production readiness for the agreed full launch:** Production
   D1 selects Xiaodou and MK99 is disabled; there are no Production MK99
   credentials or approvals. Add independent Production merchant credentials
   and verify the Production channels, cashier origins, exact buyer-total
   contract, notification URL and retry/support path. The existing
   `PAYMENT_PROVIDER=xiaodou` preflight condition preserves the legacy
   Xiaodou notification path and does not block MK99, whose new-order routing
   comes from the audited D1 merchant settings. Staging acceptance does not
   substitute for one separately authorized, human-funded Production
   acceptance order. Keep both purchase gates closed until that acceptance
   passes and the owner gives final open-sales approval.
4. **P0 for admin-console use — one-time admin bootstrap:** D1 has no users or admin. A local-only,
   fail-closed bootstrap tool is now prepared at
   [`../../tools/production-admin-bootstrap/README.md`](../../tools/production-admin-bootstrap/README.md).
   It has only been exercised against in-memory SQLite fixtures. It has not
   connected to or written Production. First complete registration and email
   verification, then review the candidate's stable user ID and expected email;
   actual Production execution needs separate explicit owner authorization.
5. **P0 — legal/support approval:** live privacy and terms pages visibly say
   “Draft”; privacy also says the account/data-request contact is pending. The
   operator must provide business identity, support/privacy contacts, retention
   and deletion process, and approve final terms/refund wording. Do not launch
   while these pages remain drafts.
6. **P1 — registration email:** verify the Production sender identity and test
   verification and password reset with purchases still closed.
7. **P1 — model cost schedule:** configure the existing DeepSeek key and align
   cost estimation with peak/off-peak prices; retain the $1/day database budget
   until the operator approves a different one.
8. **P0 for full public launch — Chrome Web Store:** the extension ID is stable, but the listing is not
   approved/published. The ignored local Production ZIP/audit records an older
   2026-10-23 dirty-tree build at commit `65e243d`; it is not the reviewed
   release package and must not be uploaded. Rebuild and audit from the reviewed
   release commit after the Production build is coordinated. Finish the
   `debugger` permission rationale, privacy questionnaire, real screenshots and
   support contact. Submit only after separate owner approval.

## Operator information needed

- Existing DeepSeek API key through the secure Worker Secret prompt and approval
  of the current cost policy; do not create or rotate a key.
- Existing Resend API key through the secure Worker Secret prompt, plus an
  explicit choice of sender: either approve an exact address under the existing
  verified `mail-staging.x-reply-helper.top` domain for the initial launch, or
  verify `mail.x-reply-helper.top` in Resend and use an address there. Set the
  selected address as the non-secret `MAIL_FROM` Worker variable.
- Public Site Key from the existing `Reply Copilot Production Registration`
  widget. The domain allowlist is confirmed; the secret pairing will be proven
  by an authorized successful registration challenge without reading the
  write-only secret.
- Production MK99 PID, merchant private key, platform public key, approved
  channels, official cashier origin, explicit Production protocol/amount
  contract confirmation and the exact notify URL. Enter credentials only
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
5. Keep purchases closed through registration, AI and extension checks. After
   Production MK99 is independently verified, separately authorize one
   human-funded Production acceptance order. Only after its webhook, amount,
   unique ledger/batch and balance synchronization pass should the owner open
   public sales; free and paid features can then launch together.
6. Submit the Chrome Web Store listing only after the Production build and
   privacy/legal disclosures are approved.

## Database backup/migration status

Production D1 0001–0017 is complete. A pre-migration backup plus isolated restore
and migration rehearsal was previously verified. This task performed only
read-only remote checks and did not create a new backup or run a migration.

## Current task boundary

The Phase 1 source baseline was `7319a4d4911dfbc5ccf843046c2ac40d21577ec8` on
`codex/v0.4-credits`, matching `origin/codex/v0.4-credits` before the
documentation-only changes in this review. `npm test` passed 530/530 tests and
the Staging Pages build. The local Production preflight reported no static
blockers; this does not prove Production credentials, merchant approval or
runtime integration.

The administrator bootstrap utility and local tests do not mean an administrator
has been created. Cloudflare checks in this task were read-only and confirmed
the existing resource identity, latest deployment metadata, Secret **names**,
Pages build-variable absence, closed payment/admin settings, empty business
data, and an empty foreign-key check. Secret values were not read. Resend's
read-only domain list showed only the verified sending-enabled
`mail-staging.x-reply-helper.top`; no email was sent. Turnstile metadata
confirmed the existing Production widget's hostname allowlist, but its
write-only secret pairing was not verified. This task did not write Production
D1, change Production configuration, modify Staging, send email, or deploy.

The direct HTTP `/health` and `/v1/packages` smoke checks could not be repeated
from this execution environment because its network resolver could not resolve
the Production API hostname. Cloudflare resource/deployment/binding/D1 checks
did succeed; they are not a fresh HTTP API smoke test.

The local Production preflight ran successfully: 17 migration files replayed
against an isolated in-memory SQLite database, integrity check was `ok`, all
business tables were empty, the default purchase gate was closed, and static
configuration blockers were empty. This is a local config/migration check; it
does not inspect write-only Secret values, prove MK99 merchant readiness, or
replace a remote API smoke test.
