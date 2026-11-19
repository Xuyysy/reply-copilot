# CF Free — lazy USDT admin history and reconciliation
Date: 2026-11-19. Base: bee798709eb44e3bf6d8e637ed2a436ca0fbd94e (release/production).

## Reason
The Production Pages source mounted the USDT audit reconciliation component inside a
visually closed HTML details element, but passed it `active={active}`. Entering the
USDT operator tab therefore fetched cross-ledger reconciliation and historical
invoice lists even if the operator never opened historical records. The
reconciliation endpoint calculates exact all-order counts and exception reasons,
potentially causing avoidable D1 reads as the database grows.

## Bounded proposal
- Operator controls and availability continue to load on entering the USDT tab.
- Historical order list and read-only reconciliation load only when the operator
  expands "Historical orders & reconciliation".
- Existing filters, exact historical statuses/amounts, audit evidence, manual
  refresh and server-side authentication remain unchanged; no fake zero stats.
- Re-entering an already-open disclosure revalidates its data. Closing it or
  navigating away ignores stale React responses; it does not cancel or mutate
  existing orders.
- The immutable backend and its protected financial/accounting queries are NOT
  modified.

## Evidence and release limits
This is a source-observed unnecessary GET, not an independently quantified
Production D1 savings claim. Verify local React/web tests and full exact-SHA CI.
Requires separate authorized Pages release, not Worker, and no D1 SQL
(SELECT included), D1 migration, payment, refund, order edits, role/auth
bypass, Cloudflare configuration change or plan downgrade. Free stays NO-GO
until full postrelease UTC-day account Analytics and route CPU assessment.
