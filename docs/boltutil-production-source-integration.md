# BoltUtil Production source integration candidate — 2026-11-16

## Scope
This branch is based on the exact Production source SHA
`48db0ce43a7a08df0b71f4d60441c1c989e063fd`.
BoltUtil code and its independent admin switches come from validated PR #149
(`6ff6b46ba4b3bf185de5736fe423f74ad26d85dc`),
not from a wholesale Staging branch merge.

The following production-only existing features are deliberately preserved
unchanged: MK99 and Xiaodou payment requests, invoices, signed notifications,
transaction cancellation/retry reconciliation, referral/reward paths,
production-specific account flows and current payment policy. Do not replace
the actual Production files with Staging copies.

## Customer and admin functionality
- Independently accessible five-network native USDT cashier. Server-side
  availability is the only authority for presenting purchase CTAs.
- New credit orders, subscriptions, subscription upgrades, owner-scoped lookup,
  refunds not supported without a separate design, and signed status refresh
  use BoltUtil's distinct ledger and proof domain.
- Owner-visible USDT credit and subscription orders inside corresponding
  account history sections.
- Admin USDT workspace: audited master + TRC20/Polygon/BEP20/ERC20/Solana
  operator switches, recent order evidence and manual review queue.
- Existing fiat subscriptions continue to use their own original merchant,
  retry/reconciliation UX and payment controls.

## Fail-closed release
- **Production starts with zero operator switches; master and all networks OFF**.
- Even an authorized admin cannot override Worker-level hard gates:
  `BOLTUTIL_ENABLED`, `BOLTUTIL_SCHEMA_READY`,
  `BOLTUTIL_PRODUCTION_CREATE_ENABLED`, network flags, validated FX and
  provider secret bindings.
- Production subscription evidence is queried from BoltUtil tables only
  when the Production schema-ready flag has been deliberately set following
  an authorized migration.
- Existing initiated orders continue status queries, trusted callbacks,
  and exactly-once credit/subscription reconciliation after new sales pause.
- No merchant keys or addresses are displayed by admin controls. The
  cashier exposes only verified order payment details for that buyer.
- Admin switches use the existing `system_settings` table; they do not
  require an additional database migration, but the USDT order tables DO.

## External prerequisites (NOT authorized by this code PR)
1. Obtain fresh explicit owner authorization even for read-only remote
   Production D1 schema inspection. Compare migration proposal
   `api/sql-proposals/0031_boltutil_five_networks_production_initial.sql`
   against the actual Production schema before obtaining separate approval
   to run it.
2. Obtain owner-approved real Production CNY/USDT quote; **never copy**
   the Staging test setting 7 CNY/USDT.
3. Independently verify merchant-wallet/token-network mapping,
   provider signed create/status/webhook credentials and fee treatment.
4. Preserve Production Worker credentials, bindings, MK99/Xiaodou traffic,
   route mappings and retry/risk semantics during a separately approved,
   exact-SHA release.
5. Keep `BOLTUTIL_PRODUCTION_CREATE_ENABLED=0` and operator master OFF
   until separate per-chain live activation approval and human money E2E.
6. Validate any future changed Production base SHA before merge; update
   branch by new commit (never force push).

## Verification
Code-review and CI evidence belong to the exact PR head, not historical
Staging PR #149. Full Push CI, separate Production build, artifacts and
manual deployment approval are distinct. Passing tests does not prove
Production migration, wallet correctness, or real-money acceptance.

## PR-scoped offline Production candidate build (2026-11-16)

Production Build now accepts same-repository PRs targeting release/production
when BoltUtil files or build-guard files change. It checks out the exact PR
head SHA, builds immutable Worker/Pages/Chrome packages, verifies all digests,
and uploads the candidate. The job has read-only GitHub permission and never
uses Cloudflare credentials, executes D1, deploys or performs real payment.

The source preflight and artifact verifier reject a committed source config
that enables any BoltUtil global/schema/production-create/network flag, or
contains merchant API/webhook credentials or a quoted FX rate. Existing
MK99/Xiaodou payments and Production D1 binding are preserved.

**A PR candidate build is not a releasable Production artifact.** Existing
manual release verification still requires a separate successful full CI
and Production Build triggered by push to release/production, pinned to the
identical source SHA. D1 schema verification/migration, FX, wallet, callback
and per-chain activation need separate human approvals.
