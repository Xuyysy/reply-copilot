# CF Free — account-wide, read-only, complete-UTC-day readiness gate

Updated 2026-11-17.

## Verified release and purpose

PR #166 Worker and Pages deploys for source `f178dec65110a582ccedd3769165528709fbd7a0` were independently verified via GitHub Actions and the Cloudflare control plane. Current Worker 100% version: `b10bdc5b-c9db-4d93-b0c8-b11e120376fb`. Pages commit matches. Existing 56 bindings, D1, payments and all five USDT networks were preserved; `PASSWORD_FREE_CPU_ENABLED` and `PASSWORD_LEGACY_MIGRATION_ENABLED` are **both absent/OFF**.

Read-only Cloudflare GraphQL (2026-11-17 07:15 UTC 15-minute sample) showed Production Worker `3ab4eb62-226f-4114-8b37-8c35c0f9ab15` CPU P95 **12.944ms**, P99 **16.284ms**, and max **22.515ms** among 103 successful HTTP 200 requests. That is a **previous deployed version** in the sampled window, not an attributable measurement of the newest Worker. The 07:30 window for the new version contained only 3 successful requests, not enough to assess Free CPU. **No Free downgrade is authorized.**

## What the gate actually does

`scripts/cf-free-readiness.mjs` queries **only Cloudflare GraphQL Analytics** for 1–7 *complete UTC days*; it does not execute D1 SQL, Cloudflare configuration updates, Workers deployments or third-party requests. It makes a single authorized, read-only API POST per day with a narrow fixed query.

It deliberately sums **all D1 databases in the account** (not only Production D1) and **all Workers invocation counts** (including Cron conservatively, while separately identifying HTTP fetch CPU). It also reports Production Worker versions and Production D1 rows so the user can understand which deployment was active. It compares aggregate metrics against the currently documented Workers Free and D1 quotas:

| Gate | Account-level or per-request limit |
|---|---|
| Worker requests | 100,000 per UTC day (all Workers) |
| D1 rows read | 5,000,000 per UTC day (all databases) |
| D1 rows written | 100,000 per UTC day (all databases) |
| Worker CPU | 10ms per HTTP fetch invocation (across Workers, not just P95); Cron classified separately |

Source: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/d1/platform/pricing/.

Outputs:
- `NO_GO`: any limit reached, sampled max CPU >=10ms, or Worker errors present.
- `INSUFFICIENT`: data missing/truncated, the version to evaluate not observed, the UTC day contains predeployment time, or D1 read headroom exceeds the conservative 3M/day preference.
- `REVIEW_REQUIRED`: all observed thresholds appear clear, but **never** an automatic GO; Cloudflare adaptive GraphQL sampling cannot prove every invocation is under 10ms, user/admin session critical routes may be unsampled, and storage (5GB across D1) plus database-count, other account billing and actual subscription must be separately checked.

The JSON permanently sets `certifiedForFree:false`. Neither a successful report nor a green CI authorizes plan downgrade.

## Operating procedure

The script runs on Node 22 and uses `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (the existing protected GitHub Actions secrets). It does not need D1 binding credentials, SSH keys, application secrets or a password.

For an authorized local shell / secure runner, set the account/token in its environment and run:

```bash
node --test tests/cf-free-readiness.test.mjs
node scripts/cf-free-readiness.mjs --days 3 \
  --expected-version b10bdc5b-c9db-4d93-b0c8-b11e120376fb \
  --release-at 2026-11-17T07:30:00Z
```

The release timestamp above is an *illustrative approximate timestamp*; use the exact verified deployment time for a real run. Omitting both version/release options permits historical trend reporting but **not** new-version certification. Historical days before release are expected to be marked `INSUFFICIENT` when `--release-at` is set. Once a complete UTC day AFTER release exists, use `--days 1` for the newest evaluation.

The `.github/workflows/cf-free-readiness.yml` workflow provides a manual, read-only runner with synthetic regression checks and sanitized markdown + JSON artifacts; it uses the repository's existing protected Cloudflare secrets. The workflow can be dispatched from GitHub only once the workflow file is present on the repository **default branch**, as required by GitHub Actions. This PR targets `release/production`, so until the workflow is explicitly promoted to `main`, run the script locally/on a secure runner instead. The workflow intentionally has no schedule and cannot downgrade Cloudflare or modify production.

We do not echo tokens, raw JSON API responses, passwords, session cookies, payment details, D1 query text, rows or identities. Missing API permission or data yields an error/insufficient state, never a false pass.

## Empirical baseline for comparison (complete UTC days before the recent releases)

Cloudflare read-only account GraphQL for 2026-11-16 returned:
- Production D1 rows read: **27,752,767**
- Staging D1 rows read: **448,233**
- Total D1 rows read: **28,201,000** (before postrelease optimization)
- Production D1 rows written: **18,904**; Staging D1 **10,818**
- The day included older Worker versions. It cannot serve as new Worker CPU acceptance evidence.

A full post-deploy UTC day is mandatory. A 15-minute total of 17 or 1,788 D1 rows is *not* proof that the Free 5M/day cap is safe.

## Production safety and rollback

This PR introduces only an operational script, its synthetic tests, a read-only manually triggered workflow and documentation. **No Worker or Pages application binaries change.** No deployment is necessary to gain the code-only capability; the GitHub protected Production Build may still run its normal immutable build. No D1 migration, no account config update, no Secrets rotation, no payment/credit/USDT changes and no Production/Staging/replica SQL.

The opt-in password migration flags remain OFF. The last confirmed Worker+Pages version stays live. Do not turn off or remove rollback verification support for 60k/100k/210k PBKDF2, and do not switch plans based on this gate alone.

Next CPU diagnostic, if thresholds remain exceeded: Cloudflare CPU profiling/trace a representative real request without exposing request payloads or credentials, then optimize that **identified** route. Do not attribute anonymous aggregate CPU tails to password verification without a per-route profile.
