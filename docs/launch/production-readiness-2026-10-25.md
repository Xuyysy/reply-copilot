# Production readiness — 2026-10-25

## 2026-10-25 release-preparation update

The operator reports that the Resend production sender domain
`x-reply-helper.top` is now created and verified, with all four DNS
authentication checks passing. Use the explicitly selected sender
`Reply Copilot <no-reply@x-reply-helper.top>`; do not use the old staging
sender or create another domain. Resend read-only metadata confirms the domain
is verified and sending is enabled. The existing key's permission and domain
scope are not exposed by the read-only key listing; check them in the
Dashboard before loading the existing key into Production. Do not infer scope
from its name or create, rotate, or expose key material during preparation.

The production Turnstile widget is the existing `Reply Copilot Production
Registration`, with the public site key
`0x4AAAAAAFhsvhYsTlFR6LIM` and hostname `app.x-reply-helper.top`. The existing
Worker `TURNSTILE_SECRET_KEY` is write-only and must remain untouched. Pairing
can only be proven through the real registration flow: a valid challenge is
sent to Cloudflare Siteverify and must match the configured hostname and the
`register` action. That same flow writes a pending registration and sends a
verification email, so it requires a separately authorized, coordinated
registration window; do not use it as a “no-write” probe.

The approved local source commit is `15777e36372617c64ea8da41301f5cb16c81e321`
on `codex/v0.4-credits` before this documentation/tooling-only update. The
Production Pages build and extension package were prepared from that code
baseline; neither was deployed or submitted to the Chrome Web Store. The
production purchase and admin gates remain closed. No Production secrets,
database, merchant settings, or runtime resources were changed in this
preparation update.

### Exact Production configuration inventory

Add only during a separately authorized release window:

| Kind | Name | Source / validation |
| --- | --- | --- |
| Worker Secret | `DEEPSEEK_API_KEY` | Existing DeepSeek account key; confirm account billing and key is active. |
| Worker Secret | `MAIL_API_KEY` | Existing Resend key; first verify its sending permission includes `x-reply-helper.top`. |
| Worker setting | `MAIL_FROM` | `Reply Copilot <no-reply@x-reply-helper.top>`; operator-approved exact sender. |
| Pages build variable | `PUBLIC_API_BASE_URL` | `https://api.x-reply-helper.top`; build-time value, not a Worker binding. |
| Pages build variable | `PUBLIC_TURNSTILE_SITE_KEY` | Existing widget public Site Key above; public value, build-time only. |
| Worker Secret | `MK99_PID` | Prefer the existing merchant PID if the merchant console confirms it is enabled for the Production app. |
| Worker Secret | `MK99_PRIVATE_KEY` | Prefer the existing merchant RSA private key from its original local source if that key remains registered for the Production app. |
| Worker Secret | `MK99_PLATFORM_PUBLIC_KEY` | Official platform public key for the same MK99 account/application; confirm it in the merchant console. |
| Worker setting | `MK99_BASE_URL` | Confirm Production API root from the Production merchant console/docs. |
| Worker setting | `MK99_CASHIER_ORIGINS` | Exact Production cashier HTTPS origin(s), independently confirmed. |
| Worker settings | `MK99_REQUEST_SIGN_TYPE`, `MK99_NOTIFY_SIGN_TYPE` | `RSA` only after checking the Production account’s protocol settings. |
| Worker settings | `MK99_PROTOCOL_CONFIRMED`, `MK99_AMOUNT_CONTRACT` | Set to `1` and `CNY_EXACT_BUYER_TOTAL` only after Production terms are verified. |

Do not replace `AUTH_HASH_SECRET`, `PASSWORD_PEPPER`, or `TURNSTILE_SECRET_KEY`.
Do not export or read Staging Worker Secrets. Reuse original merchant
credentials from their authoritative local files or merchant portal only when
the existing account/application confirms they apply to Production; do not
create a new merchant account or key pair by default. Do not copy Staging
channel approvals or financial data. Keep `PAYMENTS_ENABLED=0`, D1 `purchase_enabled=0`,
`ADMIN_PORTAL_ENABLED=0`, and all Production MK99 purchase/provider/channel
controls closed until the acceptance sequence below is authorized.

### MK99 account/environment finding

The supplied MK99 interface document and the repository's reviewed copy of
`https://mk99.cn/docs` identify the live API root and a demo page, but do not
state that Staging and Production must use different merchant accounts, nor do
they describe a sandbox API or account-isolation rule. The documented `pid` is
the merchant identity; it is not an environment selector. Therefore there is
no evidence-based requirement to open a second merchant account. The existing
account, PID, and RSA pair are the preferred candidates for reuse; public
documents do not prove whether this merchant's app-level approval allows both
Staging and Production. In the merchant console, check whether the existing
PID/key registration and approved channels cover the Production callback and
cashier flow. Reuse them if they do. If the console shows a Production
restriction or a different registered key, report that concrete reason before
considering a replacement. Never export Staging Worker Secrets. The
public documents list payment types but do not prove this merchant's approval
or the final cashier hostname; confirm those in the console before setting
`MK99_CASHIER_ORIGINS`.

### Secure Production Secret candidate workflow

The local helper `scripts/production-secret-bundle.mjs` collects five values
without sending them anywhere: the existing DeepSeek and Resend API keys are
entered with terminal echo disabled, while the existing MK99 PID and RSA keys
are sourced from their authoritative local files/merchant console when
approved for Production. It performs
basic format checks only (not proof of key ownership, merchant approval, or
platform connectivity), writes a JSON bundle under `/private/tmp` with mode
`0600`, and prints only the file path. It is local tooling; it makes
no Cloudflare calls. Run it only during the separately approved release
window:

```sh
cd "/Users/xuyaoyang/x posst/apps/reply-copilot"
node scripts/production-secret-bundle.mjs
```

First inspect the existing Resend key in Resend → API Keys. Reuse it if it has
email-sending permission and its domain scope includes `x-reply-helper.top`;
the key's name is not evidence of its scope. Resend says permission and domain
scope can be edited in its Dashboard, so adjust the existing key there if
needed before considering replacement. The connected read-only key listing
does not expose scope. Supply the existing DeepSeek key through the hidden
prompt after confirming it is active; do not rotate it. Reuse the MK99 PID and
key pair if the merchant console confirms Production use. Never export
Staging Worker Secrets. The helper does not modify the Worker or upload the
bundle. Delete the temporary file after upload and verify it is gone; never
attach it to Git, chat, a build artifact, or a log.

After the authorized upload, delete the bundle (`rm -f "$BUNDLE"`) and verify
that the path no longer exists. `BUNDLE` should contain only the file path
printed by the helper, never a credential value.

At the approved release window, first inspect the exact config target and
current versions, then upload a candidate version without shifting traffic.
Use the dedicated Production config and omit `--env`:

```sh
cd "/Users/xuyaoyang/x posst/apps/reply-copilot/api"
BUNDLE='/private/tmp/replace-with-the-exact-path-printed-by-the-helper.json'
COMMIT=$(git -C .. rev-parse HEAD)
MK99_CASHIER_ORIGIN='https://replace-with-console-confirmed-origin'
test -n "$MK99_CASHIER_ORIGIN"  # exact confirmed HTTPS origin, no URL path
test -f "$BUNDLE"
node node_modules/wrangler/bin/wrangler.js versions upload \
  --config deploy/production.wrangler.json \
  --secrets-file "$BUNDLE" \
  --var 'MAIL_FROM:Reply Copilot <no-reply@x-reply-helper.top>' \
  --var 'MK99_BASE_URL:https://mk99.cn' \
  --var 'MK99_REQUEST_SIGN_TYPE:RSA' \
  --var 'MK99_NOTIFY_SIGN_TYPE:RSA' \
  --var "MK99_CASHIER_ORIGINS:${MK99_CASHIER_ORIGIN}" \
  --var 'MK99_PROTOCOL_CONFIRMED:1' \
  --var 'MK99_AMOUNT_CONTRACT:CNY_EXACT_BUYER_TOTAL' \
  --keep-vars --strict \
  --message "Production candidate $COMMIT"
```

Wrangler's current local help confirms this uploads a Worker Version and that
`--secrets-file` is additive; omitted existing Secrets are not deleted.
`--keep-vars` preserves dashboard-managed variables. Inspect the returned
version ID and binding/variable names in Cloudflare before any traffic
deployment. Do not shift traffic in the preparation step. After a separate
deployment authorization and candidate smoke checks, the controlled switch
and rollback shape is:

```sh
node node_modules/wrangler/bin/wrangler.js versions deploy \
  'CANDIDATE_VERSION_ID@100' --config deploy/production.wrangler.json \
  --name reply-copilot-api-production
node node_modules/wrangler/bin/wrangler.js versions deploy \
  'PREVIOUS_VERSION_ID@100' --config deploy/production.wrangler.json \
  --name reply-copilot-api-production
```

The first command is deployment; the second is rollback and must only be run
after checking the version IDs. Record the active secrets/vars and D1 settings
separately because a code rollback is not a substitute for verifying or
restoring configuration. Replace the cashier-origin placeholder only after
verifying the real pay URL origin. Only include the protocol/amount-confirmed
vars if the Production merchant configuration independently supports them;
otherwise leave them absent and keep MK99 unavailable. Do not run either
command until the appropriate Production authorization is given.

For Pages, build and inspect locally before upload, with only public build
values supplied at build time:

```sh
cd "/Users/xuyaoyang/x posst/apps/reply-copilot"
COMMIT=$(git rev-parse HEAD)
PUBLIC_API_BASE_URL=https://api.x-reply-helper.top \
PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAFhsvhYsTlFR6LIM \
  npm --prefix web run build:production
node api/node_modules/wrangler/bin/wrangler.js pages deploy web/dist \
  --project-name x-reply-helper-production --branch main \
  --commit-hash "$COMMIT"
```

Inspect generated assets for the exact Production API origin and Site Key and
for absence of Staging origins before the Pages upload. A Pages deployment to
the production branch changes the live site; it requires the same explicit
deployment window. Record the preceding Pages deployment ID first and use the
Cloudflare Pages dashboard's rollback action if post-deploy checks fail.

### Controlled release sequence and approval gates

1. **Operator console preparation (no Production changes):**
   - DeepSeek Open Platform → API Keys: confirm the existing key is active and
     account billing is usable; do not paste it into chat.
   - Resend → Domains: verify `x-reply-helper.top` remains verified and sending
     enabled. Resend → API Keys: create a dedicated Production key with
     Sending access; restrict it to `x-reply-helper.top` if the UI offers that
     scope. If only broader scope is available, review the permission before
     deciding whether to create/use it. Do not copy a staging key value.
   - MK99 Production merchant console: verify merchant PID, RSA request and
     notification signing modes, approved Production channels, exact cashier
     origins, asynchronous notify URL `https://api.x-reply-helper.top/v1/payments/mk99/notify`,
     buyer-total contract and fee bearer. Keep credentials out of chat.
2. **Configuration release authorization:** add the missing Production Worker
   secrets/settings listed above through the existing Worker’s Settings →
   Variables and Secrets. Batch this with the release window; do not use a
   mistaken Wrangler `--env` target. Preserve existing auth and Turnstile
   secrets. Keep payment/admin switches and D1 operator controls closed.
3. **Deployment authorization:** deploy reviewed Worker code to the existing
   `reply-copilot-api-production`; build Pages with both exact Production
   public variables and deploy to the existing `x-reply-helper-production`.
   Do not recreate resources or rerun migration `0017`. Verify build output,
   health/API, CORS, login/register route, closed payment/admin states, and
   extension origin.
4. **Registration and Turnstile authorization:** the owner uses the normal
   registration form at `https://app.x-reply-helper.top/login?mode=register`,
   completes the widget, and receives the verification message at their own
   email. A successful challenge proves Site Key/Secret pairing plus hostname
   and action checks; it also creates a pending registration and sends a real
   email. Verify email and the 200-credit grant, then obtain the stable user ID.
5. **Administrator bootstrap authorization:** review the exact Production
   D1 target and user identity, then separately authorize the one-time local
   bootstrap tool. Read-only verify singleton admin binding/audit entry before
   separately authorizing `ADMIN_PORTAL_ENABLED=1`.
6. **Production paid acceptance authorization:** through the admin console,
   select MK99 and only Production-approved channels while both purchase gates
   remain closed. Then explicitly authorize a short acceptance window. The
   owner creates and funds one real small order; verify authentic callback,
   exact amount, paid state, one event, one credit batch and one ledger grant.
   Restore both purchase gates closed unless the owner explicitly gives final
   public-sales authorization.
7. **Public release authorization:** only after legal/support copy, AI,
   registration, extension, admin and payment acceptance pass, separately
   authorize opening public purchasing and submitting the Chrome Web Store
   listing. No store submission is part of configuration or deployment prep.

### Prepared artifacts and rollback anchors

- Pages archive: `/private/tmp/reply-copilot-pages-production-15777e3.tar.gz`
  (SHA-256 `f5c21e766259c77ebbb653ac41e3d4c69af309bcb6724dfbf7d3815d95d85611`).
- Chrome package:
  `dist/release/reply-copilot-production-0.3.0.zip` (SHA-256
  `a6d7b6ac4a0a5efc3e1da0ea5d9125f5262fa088becd6bc250d1647787554053`).
  Candidate only; do not submit before public-release approval.
- At preparation time, observed Worker rollback version was
  `5a48f3e0-b8be-4cdb-b1c9-ef3c61657bde`; Pages production deployment was
  `8cbf234d-4945-4cc3-b3e6-9349b248cbca`. Refresh both immediately before any
  release. Cloudflare supports rolling a Worker deployment back to a selected
  version and rolling Pages to a previous successful production deployment.
  Code rollback does not revert Secrets, D1 state, or admin payment settings;
  restore those separately from the release record.

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
| `MK99_PID` | Merchant identity | Reuse the existing PID if the merchant console shows it is approved for Production; enter via the Worker Secret store |
| `MK99_PRIVATE_KEY` | Signs MK99 API requests | Reuse the existing local private key if its public pair is registered for Production; enter via the Worker Secret store |
| `MK99_PLATFORM_PUBLIC_KEY` | Verifies MK99 notifications | Use the official platform public key for the same approved merchant application; enter via the Worker Secret store |

Never export values from Staging Worker Secrets. Enter existing credentials
from their authoritative local source only after confirming they apply to
Production. Never put secrets in Git, chat, Pages variables, URLs, command
arguments, or logs. `MAIL_FROM` is absent from the Production
Worker and is a non-secret Worker variable. The operator now reports that
`x-reply-helper.top` is verified and all four DNS authentication checks passed.
The selected Production sender is
`Reply Copilot <no-reply@x-reply-helper.top>`. This supersedes the earlier
read-only observation that only the staging domain was verified. The existing
Resend API key's sending permission and domain scope still need to be checked
in Resend before Production configuration; do not create or rotate a key as
part of this preparation.

### Public and non-secret settings

- Direct Upload Pages builds require
  `PUBLIC_API_BASE_URL=https://api.x-reply-helper.top` at build time. This is not
  a Worker variable and is not injected by Cloudflare Pages project settings in
  this Direct Upload setup. Build with `npm --prefix web run build:production`
  and inject both public values into that build. Do not deploy the local test
  Site Key used by earlier build checks.
- Cloudflare has an existing widget named `Reply Copilot Production
  Registration`, and read-only metadata confirms its allowed hostname is
  `app.x-reply-helper.top`. The public Site Key is
  `0x4AAAAAAFhsvhYsTlFR6LIM`. `PUBLIC_TURNSTILE_SITE_KEY` is absent from the
  Pages project's saved Direct Upload environment slots; inject the Site Key
  only at Production build time.
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
   DeepSeek and Resend API key bindings and `MAIL_FROM`. The production sender
   domain is verified, and the sender is selected; the remaining mail blocker
   is confirming an existing or production-scoped Resend key can send from
   `x-reply-helper.top`.
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
   operator must provide the public business/operator identity, one working
   support/privacy contact, the actual data-retention and account-deletion
   process, and approve the existing terms and legally required payment/refund
   wording. No new refund automation is needed, but the public copy must not
   promise unsupported refunds or deny statutory rights. Do not launch while
   these pages remain drafts.
6. **P1 — registration email:** send an authorized verification and password
   reset test to an operator-controlled mailbox with purchases still closed.
7. **P1 — model cost schedule:** configure the existing DeepSeek key and align
   cost estimation with peak/off-peak prices; retain the $1/day database budget
   until the operator approves a different one.
8. **P0 for full public launch — Chrome Web Store:** the extension ID is stable,
   but the listing is not approved/published. A clean Production candidate was
   built from `15777e36372617c64ea8da41301f5cb16c81e321` and locally audited;
   it remains unsubmitted. Finish the `debugger` permission rationale, privacy
   questionnaire, real screenshots and support contact. Submit only after
   separate owner approval.

## Operator information needed

- Confirm the existing DeepSeek key is active and the current $1/day budget
  policy is accepted; enter it through the hidden local helper only in the
  authorized release window. Do not create or rotate a key.
- In Resend → API Keys, inspect the existing key's permission and domain scope;
  reuse it if it covers `x-reply-helper.top`, or edit its existing scope in the
  Dashboard if necessary. Create a replacement only if the existing key cannot
  be made compatible. Enter the existing key through the hidden local helper.
  `MAIL_FROM` is the approved non-secret value
  `Reply Copilot <no-reply@x-reply-helper.top>`.
- No new Turnstile widget is needed. Inject the existing widget's public Site
  Key into the Pages build. Its pairing with the write-only Worker Secret is
  proven only by the authorized registration flow, which creates a pending D1
  registration and sends a real verification email.
- In the existing MK99 merchant console, confirm the current PID/RSA
  registration and approved channels cover Production; verify cashier origin,
  callback URL `https://api.x-reply-helper.top/v1/payments/mk99/notify`, RSA
  request/notify modes and exact CNY buyer-total contract. Reuse the existing
  account and key material if those settings allow it; public docs do not
  require a separate merchant account. Enter credentials via the hidden local
  helper only during the authorized release window.
- Public business/operator identity, one working support/privacy contact, the
  actual retention and account-deletion process, and approval of existing
  privacy, terms, and legally required refund/payment wording.
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

## Earlier Phase 1 observations (historical)

The Phase 1 source baseline was `b659c7981282f7ddfeeab41e455289869c78e756`.
The source-cleanliness fix is committed and pushed as
`15777e36372617c64ea8da41301f5cb16c81e321` on `codex/v0.4-credits`.
`npm test` passed 531/531 tests, API typecheck passed, and local Production
preflight and Wrangler dry-run passed. Production credentials, merchant
approval and runtime integration still require their controlled validation.

The administrator bootstrap utility and local tests do not mean an administrator
has been created. Cloudflare checks in the earlier Phase 1 review were read-only and confirmed
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

## 2026-10-25 follow-up preparation

- Added `scripts/production-secret-bundle.mjs`. It uses hidden terminal input
  for DeepSeek/Resend API keys, reads the two RSA PEMs from local paths, writes
  a mode-0600 temporary JSON under `/private/tmp`, and performs no Cloudflare
  calls. It was tested only with dummy values; it has not been run with real
  credentials and no bundle was created.
- Fixed the Production Pages build to remove `web/dist` before building. The
  cause was verified: Astro's output directory contained a Staging-hashed API
  client from the previous Staging build, so the production verifier correctly
  refused the mixed artifact. A clean Production rebuild now contains only
  `https://api.x-reply-helper.top`; the Production Turnstile Site Key is in the
  registration HTML, and no Staging API origin remains.
- Verification: `npm test` passed 534/534; API typecheck passed; Production
  Pages build passed; `api/scripts/check-environment.mjs production` and the
  local Production preflight passed. Wrangler Production dry-run exited 0 and
  showed the existing Production D1 binding plus `PAYMENTS_ENABLED=0` and
  `ADMIN_PORTAL_ENABLED=0`. Wrangler emitted a local log-file permission
  warning under the user's Library directory; it did not prevent dry-run and
  did not write to Cloudflare.
- The diff secret-pattern scan and `git diff --check` passed. No Production
  Secret, D1, merchant setting, deployment, registration, email, payment, or
  purchase/admin switch was changed. The Production build `web/dist` is a local
  generated artifact and is not a deployed Pages release.
