# Admin V2 D1 read indexes — approval-gated rollout

Status: **candidate only**. The four indexes remain in
`api/sql-proposals/0026_admin_v2_read_indexes.sql`. They are not included in
`api/migrations/` and must not be deployed automatically.

## Source and baseline
- The pinned Admin V2 production source is
  `0d4660dcdf5a99d3dc6e74807ff1ee687a1e4798`; Worker and Pages are
  already independently deployed.
- The checked-in release branch has `0001` through `0024`.
  `0025` is reserved for independently reviewed subscription RSA2 work.
  A future `0026` migration must not be promoted or executed out of order.
- Existing `api/tests/admin-query-plans.test.mjs` uses an **isolated in-memory
  SQLite database** to verify EXPLAIN QUERY PLAN for each query pattern.
  This proves only local query-plan eligibility; it does not predict
  Production latency, table size, or live migration status.

## Planned indexes
1. `admin_subscription_orders_recent_idx` for recent all-user subscription orders.
2. `admin_credit_receipts_paid_idx` for verified credit receipts by paid_at.
3. `admin_subscription_receipts_paid_idx` for verified subscription receipts by paid_at.
4. `admin_failed_ai_recent_idx` for bounded all-user AI-failure monitoring.

These are additive schema indexes, not entitlement/payment mutation logic.

## Non-negotiable preflight before any remote D1 action
1. Obtain **fresh, action-specific user approval** for any Staging,
   Production or backup D1 access, including read-only inspection
   (SELECT, PRAGMA, EXPLAIN, export) and migration execution.
2. After approval, verify actual remote `d1_migrations`, database identity,
   0025 predecessor state, relevant table/index definitions, and realistic
   row counts; do not infer remote state from repository history.
3. Establish a restorable backup and a rollback procedure; record storage,
   verification, expected write-lock impact, and authorized maintenance window.
4. Test the proposed SQL with an isolated realistic copy or approved Staging
   dataset; compare query plans and timing **before and after**, including
   write amplification for the four affected tables.
5. Only after separate review, promote the exact SQL into the agreed numbered
   migration chain, run exact-SHA CI, then separately authorize each remote
   environment's migration. No push or PR merge should automatically run SQL.
6. Validate real Admin V2 read paths, write latency, errors and payment flows.
   Revert indexes only via a **separately approved** D1 operation after backup.

## Review and acceptance
- SQL proposal contains exactly four expected `CREATE INDEX` statements.
- Local fixture has no data loss, and the five existing query-plan tests select
  the intended indexes.
- No new migration is included in this preparation PR.
- Production D1 state is **not inspected or modified** by this work.
