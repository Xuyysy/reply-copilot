# CF Free — account polling reduction (2026-11-19)

Scope: `web/src/components/account/AccountDashboard.tsx` and `web/tests/payment-sync.test.mjs` only. Production Pages source proposal; no Worker code or Cloudflare configuration changes.

## Change

When the account dashboard is READY, increase the visible-and-focused background account snapshot refresh from 30 seconds to 60 seconds. This is the existing `watchAccountRefresh` code path; it continues reading /v1/me, /v1/usage, /v1/activity for a passive refresh and has a refresh gate to coalesce duplicate calls.

Other existing triggers are unchanged: focus/pageshow/visibility, explicit refresh/actions, server-confirmed payment events, and dedicated pending-payment verification. Browser-hidden pages remain paused. An account in an unresolved payment flow still follows the independent short-interval payment watcher; this does not alter payment status, ledger writes, entitlement proofs or merchant notifications.

## Expected impact, not measured

At a continuously visible focused account tab with no other triggers, scheduled background refresh requests drop from approximately two cycles/minute to one, i.e. about 50% fewer passive refresh cycles. Each cycle entails three GETs, so the approximate reduction is 3 GET requests/minute/tab (6 → 3); it does not imply account-wide request savings or a Worker CPU improvement without post-release measurement. Changes in login, payment flow and focus can add immediate reads as before.

## Acceptance

- Node test uses fake time: at 30 seconds, zero scheduled reads; at 60 seconds, one read; hidden pages do not poll; visibility resume refreshes; unfocused pages do not poll; disposer removes listeners and timers.
- Complete web build and existing payment/browser tests must pass.
- Source is not yet deployed; merge/release requires protected Pages workflow and separate production approval. CF Free remains NO-GO because actual Worker invocations still exceed 10ms CPU.
