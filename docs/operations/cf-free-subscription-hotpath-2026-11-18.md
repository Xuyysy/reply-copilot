# CF Free batch: subscription/Creator Momentum hot-path D1 work

Date: 2026-11-18. Source baseline: `66ab31f26785e221571b7382713b79745fa827e8` on `release/production`.

## Problem

`subscriptionAccount()` is shared by routine account, usage, generation and entitlement paths. Previously, accounts with no subscription still attempted the full fiat provider-proof SQL, BoltUtil provider-proof SQL (when schema-ready), and queued renewal lookup before returning no subscription. Creator Momentum also checked fiat and BoltUtil credit-purchase proofs before reading an already paid and verified subscription.

## Changes and security invariants

1. A single existing-index-covered `subscription_periods(user_id,status)` probe returns `none` if the account has neither `active` nor `queued` periods. No new schema/index/migration is proposed.
2. When at least one candidate period exists, **unchanged** fiat/USDT signed-event joins, user/account checks, status/time/risk constraints, per-day usage and the atomic queued renewal path still run. A period row is never itself trusted as proof of payment.
3. Creator Momentum checks subscription-backed paid proof first; successful paid subscriptions do not redundantly scan the old fiat and BoltUtil permanent-credit purchase history. Other paid users still require their original verified, refund-aware, grant-backed purchases. Available credit balance never confers paid eligibility.
4. Old/expired-only periods, unpaid and unverified events, frozen users, no schema flags, queued renewal semantics, refund risks and rollback remain governed by existing code and regression tests.

## Tests and evidence

- New fixture-level SQL capture proves no unnecessary provider joins/renewal lookup for never-subscribed and expired-only users; paid subscribers skip legacy purchase scans; unsigned/unverified subscription does not grant access.
- Synthetic Miniflare D1 test with 12,000 expired/revoked rows requires the existing covering index and bounded candidate rows read, including queued and active cases.
- Existing subscription account/renewal, BoltUtil settlement, Creator Momentum and security tests must pass in complete GitHub Push CI and PR CI. All performance claims are structural or isolated synthetic evidence, **not measured Cloudflare Production savings**.

## Rollout & Free decision

Only isolated source changes and tests; **no Production/Staging/backups D1 SQL (including SELECT), no migration, no live configuration, payments or deploy**. Staging-first compatibility/rollback acceptance, and separate Production approval are required. Cloudflare Free remains **NO-GO** until account-wide complete-UTC-day D1/Workers analytics, sampled per-request CPU, storage and login compatibility checks pass. Do not activate the 10k PBKDF2 flags as part of this batch.
