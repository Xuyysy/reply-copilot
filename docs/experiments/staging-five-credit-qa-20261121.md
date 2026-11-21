# Isolated five-use Staging subscription QA — 2026-11-21

## Purpose
Validate independent Reply generation and quota ordering quickly with a **500/day plan with 495 already used (five remaining)** active subscriber, **one free** credit and **one paid permanent** credit. This is a local synthetic D1 fixture with a mock, internally verified Staging payment event; the database `daily_limit` CHECK explicitly rejects 5, so this fixture leaves the legitimate 500 cap unchanged; it does **not** alter the four published subscription tiers or make any actual payment.

## Automated local acceptance
- First 5 unique request IDs use subscription, with daily remaining 5 → 4 → 3 → 2 → 1 → 0; ACK is the only operation that consumes each use.
- Next request uses the one free credit, then the following request uses the one paid credit.
- Subsequent request returns INSUFFICIENT_CREDITS, account entitlement is credits_exhausted, and no further allocation or debit occurs.
- With 4 already consumed, three concurrent reservations result in one subscription, one free and one paid allocation; ACK out of order is idempotent and cannot exceed the five-use subscription cap.
- On Chrome Staging #219, 0 remaining subscription plus free/paid balance must remain credits_available; only all empty shows the purchase entry.

## Strict operational distinction
This test **does not** provision a five-use subscription in the live Staging database, identify the user's test account or run any remote D1 SQL (including SELECT). The existing Staging Worker version and existing 500/1000/1500/2000 plan pricing and purchased entitlements remain unchanged. A real browser E2E with only five remaining requires a verified, isolated Staging subscriber with a valid 500/day plan and an authorized account-scoped preparation of the current day usage to 495. Remote D1 SQL is prohibited without separate permission. Never lower the plan catalog or a shared Staging global limit for this.

Full exact-head CI, then protected Staging Worker deployment and Chrome unpacked testing; do not touch Production.

## Initial failure and correction evidence
First QA CI [44914282632](https://github.com/Xuyysy/reply-copilot/actions/runs/44914282632) correctly rejected a fabricated daily_limit=5: the immutable SQLite schema enforces daily_limit IN (500,1000,1500,2000). This is a **test setup failure, not a production quota bug**. The fixed test retains the actual Basic daily_limit=500 and prepares used=495 so remainingToday=5. This preserves plan pricing and the D1 CHECK rather than loosening financial constraints. The corrected source must pass a fresh full Push CI before any handoff.

## Concurrent last-free-lot contention found in automated QA
Follow-up CI 44914781503 identified a genuine in-process concurrency edge: while one request reserves the last free credit, another preselected the same credit lot and returned GENERATION_RESERVATION_CONFLICT rather than looking for the available paid lot. QA candidate now performs a **single bounded re-selection** only after an atomic batch fails and after the same request ID, account status and AI budget are revalidated. It cannot repeat the provider invocation. The same failing test also had a local web-vs-extension session type mismatch (401), now corrected in the test harness only. Both regressions must pass a fresh exact-SHA Push CI; no live Worker or D1 is modified.
