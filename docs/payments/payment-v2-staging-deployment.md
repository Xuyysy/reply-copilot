# Payment V2 Staging deployment — 2026-10-21

## Release

- Worker: `reply-copilot-api-staging`
- Previous version: `ac43f038-f836-4329-9c1c-f6298c98e648`
- New version: `9e9c14af-034b-4cde-b774-855e983a4c60` (remote confirmed 100%)
- Pages project: `x-reply-helper-staging` (Direct Upload, its production slot; not a Production project)
- Previous deployment: `59a4dda1-0802-4e88-a343-01f67fa912d3`
- New deployment: `3dc98858-283e-4c1d-9d51-075f997723d1`
- Deployment URL: https://3dc98858.x-reply-helper-staging.pages.dev
- Website: https://staging.x-reply-helper.top
- API: https://api-staging.x-reply-helper.top
- Source: reviewed uncommitted working tree on `codex/v0.4-credits`, HEAD `65e243db89456d10e93e63d8dc301e1b7bf4068d`. No Git commit or push.

Worker was verified before Pages publication. Both uploads completed successfully; neither deployment was repeated blindly. Worker runtime source contains the V2 snapshot validator, checkout marker, raw-body SHA-256 Webhook code and manual redirect protection. Custom-domain checkout HTML references the new entry script; entry, shared API and checkout-status scripts were downloaded and compared byte-for-byte with the Staging build.

## Safety and data

All remote Worker binding metadata remained equal to the recorded previous version, including the same 12 Secret names and D1 `cd44bb44-b525-42c4-b286-2cc84dae7fdb`. Secret values were not requested or changed.

`PAYMENTS_ENABLED=0`, `XIAODOU_WEBHOOKS_ENABLED=1`, `AI_MODE=mock`, `ADMIN_PORTAL_ENABLED=0`, `REAL_DEEPSEEK_TEST_ENABLED=0`.

Read-only before/after results matched exactly for audited orders/attempts, accounts/reservations, batches, ledger, events and refunds. Summary: 2 accounts, 2 historical orders/attempts, total free 386, total paid 0, 2 batches, 17 ledger entries, 0 payment events, 0 refunds. Both historical orders remain awaiting_payment/unknown, 1006 fen, without cashier links or credit timestamps.

No remote migration, order creation, provider query, refund, balance change, WAF/DNS change or Production operation was performed.

## Verification

- Fresh full suite: 264 passed, 0 failed (includes website build and Workers runtime Mock).
- API typecheck, staging configuration check, dry-run: passed.
- Explicit Staging web build: passed with Staging API and public Turnstile site key.
- `/health`: 200.
- `/v1/packages`: 200, paymentAvailable=false; CORS allows the Staging website with credentials.
- `/login/`, `/account/`, `/checkout/?package=starter`: 200.
- `/v1/me` without a session: 401 AUTH_REQUIRED.
- One unsigned empty Webhook POST: 401 INVALID_WEBHOOK_HEADERS. No success event was sent.
- Authenticated interactive login/account actions were not performed on behalf of the user; local Mock coverage and public route/auth-boundary checks are the evidence supplied here.

Cloudflare read queries and public GETs intermittently failed with network/TLS errors (curl 35). Bounded read-only retries recovered; no certificate verification was disabled. These failures are not attributed to Xiaodou. Final required checks succeeded.

## Rollback / remaining blocker

No rollback was needed or executed. Previous Worker and Pages versions above are recorded as the compatibility recovery pair; no database rollback is needed because no schema or business rows changed.

`PAYMENT_V2_STAGING_DEPLOYED`

`BLOCKED_BY_XIAODOU_SOURCE_VALIDATION`

No real payment success is claimed. Keep checkout disabled pending a separate decision about the existing platform source-validation failure and any future real transaction test.
