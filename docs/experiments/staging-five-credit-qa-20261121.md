# Isolated five-use Staging subscription QA — 2026-11-21

## Purpose
Validate independent Reply generation and quota ordering quickly with a **five-use** active subscriber, **one free** credit and **one paid permanent** credit. This is a local synthetic D1 fixture with a mock, internally verified Staging payment event; it does **not** alter the four published subscription tiers or make any actual payment.

## Automated local acceptance
- First 5 unique request IDs use subscription, with daily remaining 5 → 4 → 3 → 2 → 1 → 0; ACK is the only operation that consumes each use.
- Next request uses the one free credit, then the following request uses the one paid credit.
- Subsequent request returns INSUFFICIENT_CREDITS, account entitlement is credits_exhausted, and no further allocation or debit occurs.
- With 4 already consumed, three concurrent reservations result in one subscription, one free and one paid allocation; ACK out of order is idempotent and cannot exceed the five-use subscription cap.
- On Chrome Staging #219, 0 remaining subscription plus free/paid balance must remain credits_available; only all empty shows the purchase entry.

## Strict operational distinction
This test **does not** provision a five-use subscription in the live Staging database, identify the user's test account or run any remote D1 SQL (including SELECT). The existing Staging Worker version and existing 500/1000/1500/2000 plan pricing and purchased entitlements remain unchanged. A real browser E2E on a five-use account requires a verified, isolated Staging user and separately approved safe account-scoped setup. Never lower the plan catalog or a shared Staging global limit for this.

Full exact-head CI, then protected Staging Worker deployment and Chrome unpacked testing; do not touch Production.
