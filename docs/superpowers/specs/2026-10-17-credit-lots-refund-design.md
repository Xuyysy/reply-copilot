# x-Reply-Helper Credit Lots and Refund Design

**Status:** Draft for product/engineering approval  
**Date:** 2026-10-17  
**Repository:** `Xuyysy/reply-copilot`  
**Branch:** `codex/v0.4-credits`

## 1. Goal and non-goals

Introduce order-specific credit lots so generation consumption and refunds can be attributed to the exact grant that supplied a credit. Keep the existing account balance, append-only ledger, order history, hosted AI, Xiaodou adapter, and local mock provider. Preserve all existing user balances and historical records.

This design does not enable real payments, issue real refunds, deploy Cloudflare, touch Production, or change the X editor input path. It does not turn historical purchases into automatically refundable purchases.

## 2. Confirmed product rules

### Credit and generation rules

1. Consume credits in this order: free signup credits, historical paid credits, then new paid purchase lots in FIFO order.
2. A generation produces the existing three candidate replies and costs one credit total.
3. At generation start, reserve one credit from one exact lot. A reservation is not yet a use and does not permanently remove balance.
4. Mark the credit consumed only after the extension receives and validates the completed response and acknowledges delivery. The UI must not expose the result before the acknowledgement is confirmed.
5. A confirmed provider/validation failure releases the reservation without recording a use and restores ordinary refund eligibility.
6. An ambiguous upstream or acknowledgement outcome remains reserved/unknown until safely reconciled; it must not be blindly released or retried as a new paid generation.
7. Each successful request has one immutable allocation to one exact credit lot. `requestId` remains idempotent.

“Delivered” in this protocol means received and validated by the extension and acknowledged to the Worker before the extension makes the reply available to the user. It cannot prove that a human read or saw a rendered pixel. If the acknowledgement response is lost, the extension retries/query-resolves the same idempotent request and does not present the result until its committed state is confirmed.

### Refund rules

1. Ordinary refund is a whole-package refund of package principal only. No partial/pro-rata ordinary refund. The service fee is excluded by default.
2. An order qualifies only when its payment is verified successful, its own batch is fully intact, no credit from it has ever been consumed, no generation reservation exists, and no refund is pending. Historical lots with uncertain attribution are not ordinarily refundable.
3. One successful use permanently removes ordinary refund eligibility for that order, regardless of later purchases.
4. A refund request freezes the selected lot atomically. Frozen credits cannot be selected for generation.
5. Verified refund success removes the exact reserved unused credits from that lot once. Verified failure releases the freeze. Unknown outcome remains frozen pending trusted reconciliation.
6. Special refunds are separate administrator-reviewed operations with reason, approval, amount split, credit adjustment, and audit history. They may refund amounts required by merchant, law, or platform rules even after use. On success they may recover only the specified order’s unused credits. Used credits remain historical/audit facts; no negative balance and no debiting another lot.
7. A full special refund collects an explicit confirmation and removes all remaining unused credits in that order’s batch. A partial special refund requires the administrator to explicitly choose the number of credits to revoke. The fee component is separately specified and audited.

### Price snapshots

| Package | Principal | User-facing fee | Captured total | Credits |
|---|---:|---:|---:|---:|
| starter | 990 fen | 16 fen | 1006 fen | 400 |
| standard | 1990 fen | 31 fen | 2021 fen | 1000 |
| large | 3290 fen | 51 fen | 3341 fen | 2000 |

New orders snapshot principal, service fee, fee rate, currency, and total at order creation. Later package or fee configuration changes never rewrite an existing order. The user-facing fee remains distinct from Xiaodou’s own settlement/merchant fee projection. Payment success validates the captured gross total; before showing cashier material the provider projection must also satisfy the existing safety rule that net merchant settlement covers at least the package principal.

## 3. Existing system and migration boundary

The current system has aggregate `credit_accounts.free_balance` and `paid_balance`, an append-only `credit_ledger`, and `ai_requests.credit_source` with only `free`/`paid`. Generation currently decrements the aggregate balance during reservation, then refunds it after a confirmed provider failure. A payment grant increases aggregate paid balance but does not create an order-specific credit record. The current admin refund reserves aggregate paid balance proportionally to refund amount.

Migration `0005_xiaodou_payments.sql` is already established and must not be edited. The previous fee work has uncommitted tests referring to `0006_payment_fee_refund_snapshots.sql`; preserve those changes and use that migration number for fee snapshots. Add a later additive migration for credit lots and generation allocations. Do not run either migration against remote D1 as part of this design/implementation phase.

## 4. Proposed data model

### `credit_batches`

One row per independently managed grant. Suggested fields:

- `id`, `user_id`, `bucket` (`free` or `paid`), `source_kind` (`signup`, `legacy_free`, `legacy_paid`, `purchase`, `admin_adjustment`).
- `source_order_id` nullable, unique for a purchase lot; never infer it for legacy rows.
- `grant_credits`, `remaining_credits`, `consumed_credits`, `generation_reserved_credits`, `refund_reserved_credits`.
- `granted_at`, optional `paid_at`, `status` (`active`, `refund_pending`, `refunded`, `manual_review`).
- `history_confidence` (`tracked` or `legacy_unknown`), optional manual-review reason.
- checks preventing negative quantities and ensuring reserved quantities do not exceed remaining credits.

For a tracked lot: `grant_credits = remaining_credits + consumed_credits + permanently_revoked_credits` (the final revoked field or equivalent must be included for special/ordinary refund accounting); generation and refund reservations are subsets of remaining, not additional credits. For a legacy lot, historical consumed quantity is unknown; the migration records current remaining balance exactly and marks provenance unknown, so it cannot pass ordinary refund checks.

### `ai_credit_allocations`

One allocation per AI request (one credit per request): `request_id`, `user_id`, `credit_batch_id`, `credits=1`, `state` (`reserved`, `consumed`, `released`), timestamps, and a unique request constraint. This is the audit link from a successful `ai_requests` row to the exact lot. Released allocations stay as audit history; they are not reused.

### `credit_accounts` compatibility counters

Keep current aggregate columns as compatibility mirrors:

- `free_balance` equals the sum of free-lot `remaining_credits`.
- `paid_balance` equals the sum of paid-lot `remaining_credits`.
- Add `generation_reserved` or equivalent aggregate if useful for efficient balance reporting; keep `paid_reserved_for_refunds` as a mirror of lot refund reservations until all old callers are migrated.

Reservations do not reduce aggregate balances. Available balance is the sum of remaining credits minus generation and refund reservations. Final AI consumption or successful refund decrements both the lot and aggregate in the same D1 transaction. A reconciliation query/job compares these sums; it must alert/stop sensitive operations on mismatch rather than silently repair money/credits.

### Payment and refund snapshots

Add additive columns to `payment_transactions` and/or `recharge_orders` (one canonical source must be chosen during implementation and exposed consistently):

- `principal_amount_fen`, `service_fee_fen`, `fee_rate_bps`, `total_amount_fen`, all `CNY`.
- Keep historical `amount_fen` semantics unchanged for old records; never recalculate historical orders.

Extend `payment_refunds` with refund kind (`ordinary`/`special`), principal component, service-fee component, total amount, credits to revoke, status/reason, requester/reviewer, and resolution/audit references. Accumulate successful refunds by component. Ordinary-refund SQL limits cumulative principal refunds to the captured principal and enforces fee refund zero. Special refund permits a separately approved fee amount and is audited. The state machine, not a mutable balance alone, is authoritative for duplicate prevention.

## 5. Historical migration and invariants

Migration is additive and deterministic:

1. Extend order/payment/refund schema with fee and component snapshots. Backfill old orders conservatively from their stored historical amount: do not invent a fee or change `amount_fen`; mark legacy snapshot source/version so old semantics remain explicit. New orders get the confirmed principal/fee/total values.
2. Create `credit_batches` and `ai_credit_allocations`, indexes, unique keys, and constraints.
3. For each existing account with a positive free balance, seed one `legacy_free` batch with `remaining_credits=free_balance`, unknown history, and no refund eligibility.
4. For each existing account with a positive paid balance, seed one `legacy_paid` batch with `remaining_credits=paid_balance`, unknown history, no `source_order_id`, and manual-review/nonrefundable status. Do not split it among old orders: current ledger is not a reliable per-order consumption map.
5. Preserve an existing `paid_reserved_for_refunds` amount by recording it as a reservation on the legacy paid batch, bounded by its remaining balance; if it cannot be mapped consistently, abort migration/mark for manual review rather than clear it.
6. Do not alter balances, users, orders, credits, grants, ledger rows, or payment/refund state during seeding. The migration assertion verifies aggregate batch sums equal existing aggregate balances for every account.
7. New signup grants create the free batch with `credit_grants`, aggregate update, and ledger entry in one D1 batch. New verified payment creates its paid batch with the order credit grant, aggregate update, ledger entry, and order credited marker in one idempotent D1 batch.

Unknown or already-in-flight AI requests from before the migration remain historical aggregate ledger entries. They are not retroactively assigned to lots. The seeded legacy rows therefore represent the current remaining balances, not the original all-time grant, and can never be presumed unused.

## 6. Atomic AI generation and delivery

1. Compute eligible batch candidates in policy order: free first; then legacy paid; then tracked paid purchase batches ordered by verified `paid_at` and stable `id` tie-breaker. Other paid adjustment lots have an explicit documented position and must never jump ahead of historical paid or an earlier purchase.
2. In a D1 `batch()` transaction, gate on the existing idempotency row/request hash, active account, site cap, AI budget, and no conflicting in-flight generation. Insert the allocation and increment that exact lot’s generation reservation only if it is active, available, and not refund-frozen. The account aggregate is unchanged. A competing refund or generation sees the committed gate/state and cannot reserve the same credit.
3. Only one statement claims an existing request id. All dependent statements require that claim/allocation. Unique constraints and conditional state transitions make duplicate requests/replays no-ops or explicit conflicts. Verify affected-row counts and invariants; a database error rolls the entire D1 batch back. D1 batches are sequential transactional batches; a zero-row conditional is not itself a SQL failure, so design statements to be gated by the winner state and add a final invariant assertion in the batch for any impossible partial result.
4. Call the provider once. A definitive provider/parse/validation failure changes the reservation to `released`, lowers the batch/account reservation counts, and closes site/budget reservation according to existing policy. A timeout or uncertain provider outcome remains `unknown` and is not reissued under a new id.
5. On a valid result, store the idempotent response as awaiting delivery. The extension validates and parses the three candidates, then sends an authenticated, CSRF-appropriate/idempotent delivery acknowledgement for the same `requestId`. Before returning/displaying the candidates, it waits for confirmed acknowledgement. The Worker atomically transitions allocation `reserved → consumed`, batch `remaining--/consumed++/generation_reserved--`, aggregate bucket balance `--`, ledger once, `ai_requests` to delivered/succeeded, and cost state to settled.
6. A confirmed failure releases the reservation and leaves `consumed_credits` untouched, restoring ordinary refund eligibility. If acknowledgement is ambiguous, retain a locked/unknown reservation until same-request status reconciliation; do not release based only on timeout. The cleanup job may release only an expired reservation known to have produced no deliverable result and no committed acknowledgement. It must not infer delivery from elapsed time.

`chrome.debugger + Input.insertText` remains untouched. Delivery acknowledgement occurs before the existing UI/editor path; there is no automatic X send.

## 7. Ordinary refund flow

1. Add a user-authenticated, CSRF-protected refund request for an order; do not reuse the admin special-refund route as the user action.
2. Load the verified paid transaction, captured principal/fee/total, purchase batch, successful-use/allocation history, active reservations, and cumulative refund state.
3. Reject unless the lot is tracked, source order matches, payment is genuinely paid, `consumed_credits=0`, `remaining_credits=grant_credits`, both reservation counters are zero, and there is no pending/succeeded refund.
4. In one D1 batch, transition the order/lot to refund pending, reserve the full lot’s remaining credits, reserve exactly the captured principal refund, snapshot fee refund as zero, and write the audit/ledger request marker. This is the race winner against generation allocation. Show that service fee is excluded before the user confirms.
5. Call Xiaodou only after the freeze commits. Local mock produces only a local mock request. Never show/claim refund success based only on a create-refund response.
6. On verified `REFUND_SUCCEEDED`, idempotently transition pending/unknown to succeeded, reduce the batch’s remaining and account paid balance by the full package credits, release reservation counters, append one purchase reversal ledger row, record the provider event, and update order status. On verified failure, clear reservations and restore active state/eligibility. On unknown, preserve reservation and lot freeze until trusted query/event/manual resolution.
7. A repeated webhook, query compensation, or client retry uses the refund ID/provider event unique key and state transition to avoid duplicate money and quota changes. Never submit a new refund number to resolve unknown automatically.

## 8. Special administrator refund flow

Use a distinct admin-only endpoint and review UI/action, existing server-side admin authorization, CSRF, sensitive-operation confirmation, and audit log. Require an explicit reason and an explicit component breakdown. The reviewer confirms:

- refund principal amount and service-fee amount separately;
- credit count to revoke from this order’s own lot;
- whether the action is full or partial, with a second explicit confirmation for partial credit adjustment;
- legal/platform/merchant reason category.

Before calling the provider, freeze only the selected order batch’s unused amount. Do not reserve used credits and do not inspect/debit other lots as a funding source. On confirmed success, revoke exactly the frozen unused credits selected, up to the order’s remaining balance; retain consumed history and record amount-to-credit decision. On failure unfreeze. On unknown keep frozen and require trusted reconciliation/manual review. A full cash refund may exceed the refundable unused credit count because legal/platform obligations can require it; the UI/audit must clearly show consumed credits retained as historical use and unused credits reclaimed. The code must never create negative balances.

## 9. Refund eligibility projection and UI

The account API returns a server-computed eligibility status per order; client-side total balance is never the source of truth. States:

- `eligible`: tracked paid lot, never used, full quantity available, no reservation/refund.
- `used_ineligible`: at least one confirmed consumption from the lot.
- `refund_pending`: requested/pending/unknown; frozen pending resolution.
- `refunded`: full ordinary refund completed or order/lot fully reclaimed per refund state.
- `manual_review`: legacy/unknown attribution, invariant mismatch, or unsupported historical order.
- `not_paid`: payment not conclusively successful.

The checkout displays principal, payment handling fee, captured total, CNY labels, USD as reference price, and the approved bilingual refund notice. Account order rows show the eligibility/review state. Special refund actions are visible only to authorized administrators. The client cannot submit trusted package price, fee, eligibility, or credit amount for ordinary refunds.

## 10. Failure, recovery, and observability

- Database failure before the provider call: transaction rolls back and no provider action occurs.
- Provider request timeout for payment/refund: mark unknown; retain reserved/frozen state; query the same external order/refund identity before any decision.
- Confirmed refund failure: release the lot freeze once.
- Confirmed refund success: reclaim only the originating lot and only once.
- AI confirmed failure: release generation reservation once.
- AI unknown: keep reservation; resolve same `requestId`; do not double-call provider.
- Idempotency conflicts, negative or inconsistent lot quantities, account-vs-lot sum mismatch, duplicate grants, and mismatched provider amount fail closed and create a privacy-safe diagnostic/audit event.
- Do not log request body, user credentials, payment secrets, provider signatures, tokens, or private reply text.

## 11. Required invariants

1. `credit_accounts.free_balance = SUM(free credit_batches.remaining_credits)` per account.
2. `credit_accounts.paid_balance = SUM(paid credit_batches.remaining_credits)` per account.
3. `0 ≤ generation_reserved_credits + refund_reserved_credits ≤ remaining_credits` per batch.
4. Batch consumed/revoked quantities never exceed grants; legacy unknown history is explicitly unknown, never treated as zero use for refund decisions.
5. Each AI request has at most one allocation; a consumed allocation has exactly one matching generation ledger debit and one account decrement.
6. Each order has at most one purchase batch and one grant ledger event.
7. Refund event application is idempotent; refund success and credit reversal happen once in the same D1 batch.
8. No operation may make an account or batch balance negative or remove credits from a different order to satisfy a refund.
9. For new fee-snapshot orders: `total_amount_fen = principal_amount_fen + service_fee_fen`; refund sums cannot exceed captured component totals. Existing snapshots remain unchanged.

## 12. Verification gates (implementation phase)

Before any future remote migration/deployment, run local migration from a copy/fixture of the existing schema and assert every account’s balances unchanged and batch sums equal. Test successful/failed/unknown AI lifecycle, exact allocation ordering, two-way concurrency races, payment/webhook idempotency, ordinary/special refunds, all three fee snapshots, and legacy manual-review status. Keep real Xiaodou and DeepSeek calls disabled. Remote Staging migration, payment enablement, and Production changes each require separate authorization.

## 13. Open implementation detail for approval

The confirmed rule “only count usage after delivery” needs an extension-to-Worker acknowledgement. The design defines delivery as extension receipt plus validation before UI exposure, not proof of human display. This is the strongest reliable boundary available without changing X or claiming visibility that the Worker cannot observe. The implementation should add the smallest authenticated acknowledgement/status API and wire it into the existing hosted AI client while preserving reply generation and X insertion behavior.
