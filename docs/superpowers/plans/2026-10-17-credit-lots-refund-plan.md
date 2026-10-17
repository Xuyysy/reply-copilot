# Credit Lots and Refunds Implementation Plan

> **Required workflow:** Apply the `superpowers:executing-plans` and `superpowers:test-driven-development` skills during implementation. This plan is a proposal for approval; do not start production-code changes until the user approves it.

**Goal:** Introduce per-grant credit batches and per-request consumption allocation, then implement safe ordinary and special refunds with immutable fee snapshots and an account-level eligibility projection.

**Architecture:** Keep `credit_accounts` and `credit_ledger` as compatibility aggregates and audit history. Add `credit_batches` as the authoritative per-grant remaining/reserved/consumed record and `ai_credit_allocations` as the request-to-lot link. Use idempotent state transitions in D1 transactional batches for generation and refunds. Add an extension delivery acknowledgement so only validated, acknowledged replies become permanent usage.

**Tech Stack:** Cloudflare Workers, D1/SQLite migrations, TypeScript, Astro + React, current Chrome MV3 extension client, existing Xiaodou adapter and local mock provider.

**Design:** `docs/superpowers/specs/2026-10-17-credit-lots-refund-design.md`

## Global Constraints

- Work only in `Xuyysy/reply-copilot`, branch `codex/v0.4-credits`.
- Preserve the two already-uncommitted fee-related test changes; do not reset or overwrite them.
- Do not edit migration `0005_xiaodou_payments.sql`; use forward-only migrations.
- Do not deploy Cloudflare, run remote D1 migrations, create real payment/refund transactions, enable real payments, call DeepSeek, modify Production, push, merge, or touch Auto Poster.
- Preserve the 200 free signup credits, package IDs/credits, dollar reference prices, CNY principal values, fee formula/snapshots, hosted AI behavior, and no-auto-send X rule.
- Do not change `chrome.debugger + Input.insertText`.
- Maintain compatibility for existing users, account balances, ledger rows, orders, and pending/unknown AI/payment/refund operations.
- Use no real keys, emails, payment credentials, or model calls in tests/logs.

## Review Focus

- Can a conditional D1 batch race leave partial account/lot state? The implementation must gate all dependent statements and make impossible partial transitions fail atomically.
- Can a refund freeze and a generation reservation both claim the same lot at once?
- Can a result be shown before its acknowledgement is committed?
- Can an ambiguous provider/acknowledgement result be incorrectly released or retried?
- Do legacy balances reconcile exactly without granting refund eligibility?
- Can special refunds recover credits from a different order or produce negative balance?
- Are refund principal, service fee, total, and provider gross amount validated against immutable order snapshots?

---

### Task 1 — Finalize migration contract and fee snapshots

**Files:**
- `api/migrations/0006_payment_fee_refund_snapshots.sql` (already referenced by the existing uncommitted fee tests; preserve and reconcile)
- `api/migrations/0007_credit_batches.sql` (new)
- `api/src/types.ts`
- migration tests under `api/tests/`

**Steps:**

1. Add/adjust failing migration tests proving old order fields remain byte-for-byte semantically unchanged and new orders can store principal, service fee, fee-rate and total snapshots.
2. Add migration 0006 additively. Keep historical `amount_fen` meaning unchanged; use explicit legacy snapshot metadata/defaults rather than guessing historical fees. New values use 990/16/1006, 1990/31/2021, 3290/51/3341 fen and 150 bps.
3. Add migration 0007 tables, indexes, constraints and deterministic legacy seed. Seed current free/paid aggregate remaining amounts into manual-review legacy batches; retain and reconcile any current aggregate refund reservation.
4. Add a migration-level invariant assertion/test for sum of free and paid lot remaining amounts versus every existing account balance, including zero-balance accounts and pending refund fixtures.
5. Run local migration tests and inspect generated SQL for SQLite/D1 compatibility. Do not run remote migrations.

**Acceptance:** Existing balances/orders/ledger remain unchanged; batch sums match aggregates exactly; old paid orders are manual-review; no legacy order is automatically refundable; new fee snapshots satisfy principal + fee = total.

### Task 2 — Track all new credit grants and allocation records

**Files:**
- `api/src/password-auth.ts`
- `api/src/payments.ts`
- `api/src/quota.ts`
- new focused credit-lot helper/module if useful
- tests under `api/tests/`

**Steps:**

1. Add failing tests for a signup grant creating exactly one free lot and payment success creating exactly one purchase lot.
2. In the same idempotent D1 batch as aggregate balance and ledger changes, insert the lot with deterministic uniqueness (`signup grant`/`order_id`) and update the grant/order credited marker.
3. Keep replayed registration verification and repeated payment webhooks from creating extra lots or credits.
4. Add balance reconciliation helpers/diagnostics that compare aggregate buckets with lot remaining sums. Fail closed on mismatch; do not silently repair balances.
5. Add generation allocation schema/state types and ensure old `ai_requests` are not retroactively mapped to purchases.

**Acceptance:** Each new grant maps to one lot and one ledger grant; all retries are idempotent; aggregate-to-lot invariants hold.

### Task 3 — Implement atomic reserve, deliver, consume and release lifecycle

**Files:**
- `api/src/quota.ts`
- `api/src/ai.ts` and/or `api/src/index.ts` for the acknowledgement/status route
- `services/hosted-ai-client.js`
- relevant extension service worker/content UI caller files discovered from the client call chain
- `api/src/cleanup.ts`
- `api/tests/` and extension tests

**Steps:**

1. Add failing tests for fixed selection order: free → legacy paid → tracked purchase FIFO; a single request allocates exactly one credit from exactly one batch.
2. Implement a conditional D1 reservation transaction. Account aggregates stay unchanged while reservation is active; batch available balance excludes both generation and refund reservations. Ensure refund and generation transitions compete on the same active batch state.
3. Add an idempotent authenticated acknowledgement/status API keyed by the existing request ID. Store valid response as awaiting delivery; only committed acknowledgement consumes the lot, updates aggregate balance and writes one ledger debit.
4. Wire the hosted client to validate/parse three candidates, acknowledge, and wait for a definitive committed result before exposing candidate data or continuing to the existing X editor insertion path.
5. On confirmed upstream/validation failure, release the same allocation once and retain existing request/budget audit semantics. On timeout/unknown, keep it reserved and resolve the same request; never trigger a second model call.
6. Update stale-generation cleanup to release only confirmed non-delivered failures. Unknown delivery/provider states remain locked until reconciliation; preserve the no-blind-retry rule.
7. Add failure-injection and two-way concurrency tests: generation vs refund; duplicate generation/ACK; lost ACK response; provider timeout; malformed three-candidate output; cleanup versus a late ACK.

**Acceptance:** Successful delivered generation reduces exactly one batch and aggregate by one once; failed generation restores availability and preserves zero consumption; unknown states cannot be spent/refunded; repeated request/ACK does not call model or debit again; three candidates still cost one credit; X insertion/send behavior is unchanged.

### Task 4 — Ordinary user refund and fee component handling

**Files:**
- `api/src/payments.ts`
- `api/src/index.ts` route wiring
- payment/refund migration if Task 1 schema proves additional fields necessary
- `api/src/account.ts`
- `web/src/components/account/AccountDashboard.tsx`
- `web/src/pages/checkout.astro` and checkout component(s)
- language dictionaries and relevant tests

**Steps:**

1. Add failing tests for eligibility: fully unused 400-credit lot; one confirmed use; free balance remaining; multiple packages; historical unknown lot; generation reservation; pending refund.
2. Add a user-authenticated, CSRF-protected ordinary-refund endpoint that derives amount/credits from server snapshots, not browser values. Permit only the entire package principal and zero fee component.
3. Atomically freeze exactly that order lot and create the refund snapshot before contacting the provider. Re-read/check affected rows; use the stable refund identity for retries.
4. On verified success reclaim the full lot once and append a single reversal ledger row; on verified failure release; unknown remains frozen. Preserve provider event idempotency.
5. Validate webhook/query gross amount against captured `total_amount_fen`, not package principal. Validate refund component totals against captured principal/fee and prior successful/pending refunds.
6. Render server-projected eligibility in account orders and add the approved CNY principal/fee/total plus bilingual refund notice at checkout. Display states `eligible`, `used_ineligible`, `refund_pending`, `refunded`, `manual_review`, `not_paid`.
7. Add tests that tampering with client price/fee/credits is ignored or rejected, fee-rate changes do not rewrite orders, duplicate payment/refund events cannot double-grant/revoke.

**Acceptance:** Ordinary refund is only whole principal for a confirmed unused tracked lot; fee is excluded; refund status drives freeze and ledger; UI reflects server truth; old orders are not repriced.

### Task 5 — Special admin-reviewed refund and audit

**Files:**
- `api/src/payments.ts`
- `api/src/admin-auth.ts` (only if existing guard needs a narrowly scoped permission)
- `api/src/index.ts`
- `api/src/admin-auth.ts` or existing admin UI component (inspect actual location before editing)
- account/admin API types and focused tests

**Steps:**

1. Add failing tests for special refund approval, fee-inclusive refund, post-use full refund, partial refund with explicit credit adjustment, insufficient unused amount, duplicate approval, failure, unknown state and audit completeness.
2. Keep special refunds on an endpoint and state path distinct from ordinary user refund. Require admin authorization, CSRF, explicit reason/category, component amounts, credits-to-revoke, and confirmation; partial credit changes require an explicit second confirmation.
3. Freeze only unused credits in the source order’s batch. Do not block required cash refund merely because some credits have been used; never debit used or other-lot credits.
4. On verified success refund the approved cash components, reclaim only the approved unused source-lot credits once, preserve consumed count, and write before/after audit facts. On failure unfreeze; on unknown keep frozen.
5. Test every provider event replay and invalid amount/credit combinations.

**Acceptance:** A special refund can satisfy policy/legal obligations after use while preserving non-negative balances and lot isolation; amount, reason, credit adjustment, actor, event and outcome are auditable.

### Task 6 — Reconciliation, regression and code review

**Files:**
- `api/src/cleanup.ts` and reconciliation helper if needed
- account/admin projection code
- migration, API, local mock and extension integration tests
- no new production changes outside the approved scope

**Steps:**

1. Add a read-only reconciliation report/test covering all account bucket sums, reservations, consumed allocations, purchase grants, refund reversals and fee component totals.
2. Add deterministic local mock scenarios for paid success, unpaid rejection, invalid signature, mismatched gross amount, repeated/concurrent webhook, payment unknown, refund success/failure/unknown, delayed success, full and special partial refunds.
3. Run all relevant API, migration, local E2E and website/extension checks. No real Xiaodou, DeepSeek, Cloudflare remote, or production service calls.
4. Review final diff for accidental changes to production config, secrets, storage keys, X debugger insertion, Auto Poster or historical data semantics.
5. Prepare a separate future Staging migration/deployment runbook. Do not execute it in this implementation phase.

**Acceptance:** All tests pass locally; aggregate/lot and order/fee invariants hold under retries, failure injection and concurrency; no remote resource was touched; no real payment or AI cost was incurred.

## Approval boundary

This document set is for review. After approval, implementation should proceed incrementally with test-first changes. Any change to the confirmed refund rules, historical balance treatment, remote migration, payment enablement, or deployment target requires a separate user decision/authorization.
