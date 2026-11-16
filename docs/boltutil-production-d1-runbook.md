# Production BoltUtil D1: local rehearsal and owner release gate

## Verified source configuration (2026-11-16)

This is a **code-only, pre-authorization** plan. No query, migration,
backup, bookmark, secret read, money movement, entitlement mutation or
deployment has occurred against Production D1. The Production Worker has
separately configured BoltUtil merchant Secret **names**; both the Worker
BoltUtil create flag and administrator operator master remain OFF. Those
facts do not establish that the merchant credentials or recipient wallets
are correct.

The proposed initial Production D1 delta is deliberately *not* in
\`api/migrations/\`. It is
\`api/sql-proposals/0031_boltutil_five_networks_production_initial.sql\`.
It must never run automatically as a side effect of CI or a Worker deploy.

## Offline migration rehearsal (safe to run now)

\`\`\`bash
node --test api/tests/boltutil-production-local-migration.test.mjs
node --test api/tests/boltutil-production-schema.test.mjs
sha256sum api/sql-proposals/0031_boltutil_five_networks_production_initial.sql
\`\`\`

The full-schema rehearsal applies all 24 current version-controlled base
migrations and the local-only subscription RSA2 compatibility proposal.
It seeds fiat MK99 and Xiaodou payment transactions, an existing CNY
subscription order, and the usual user/credit/account/settings rows. It
runs the 0031 proposal in a local SQLite transaction, checking that no
existing table definition, trigger, index or record changes; only the
approved BoltUtil tables/indexes appear. It exercises each of the five
networks, event replay uniqueness, foreign-key integrity and atomic
rollback on a partially initialized database. This tests the **local
code representation only**: it is not evidence of the live D1 schema.

## Stop / go criteria for live read-only schema verification

**Stop until owner explicitly approves a scoped read-only Production D1
schema-only inspection.** The inspection must target the exact
Production D1 binding ID, enumerate only schema object names/definitions
and necessary metadata, and never fetch user rows, credentials, payment
transactions, account records or merchant data.

- Compare live existing \`boltutil_orders\` and
  \`boltutil_payment_events\` objects, indexes, constraints and any
  \`system_settings\` table metadata against the source proposal.
- Any BoltUtil table already present, partial migration, conflicting
  index name or different schema means **stop**. Do not automatically
  drop, overwrite or repair schema.
- Record the exact 0031 SHA-256 and preflight evidence in a new owner
  approved migration note, without exposing personal/payment rows.

## Stop / go criteria for live schema migration

**Second, independent, owner action-specific approval is required** to
apply exact 0031 SQL to the verified Production D1, after safe recovery
preparation and backup/bookmark validity checks (those backup operations
also require explicit approval). Keep Worker schema-ready, creation,
master and five network flags OFF. Coordinate a maintenance window
because the remote D1 runtime may not provide the same transaction
semantics as the local SQLite fixture. Verify postflight schema only
after authorization; do not query or modify payment/user rows.

If migration fails or remote schema differs, **do not replay blindly**,
drop BoltUtil tables, or roll back by deleting financial records. Keep
USDT new-order flags OFF. Determine recovery from authorized backup
and actual schema state under a new scoped approval.

## Independent commercial / real-money gates

- Approve an actual Production CNY/USDT rate separately. Staging 7
  CNY/USDT is synthetic and must never be copied to Production.
- Verify the BoltUtil merchant identity, configured wallet receiving
  addresses and token contracts for TRON, Polygon, BNB Chain, Ethereum
  and Solana, as well as gas/fee treatment and signed callbacks.
- Only after a production-source release with immutable source SHA,
  approved remote D1 migration and signing acceptance may an operator
  request approval to arm a single chain and perform controlled E2E.
  Distinguish schema READY, provider handshake VERIFIED, accepting NEW
  invoices, and exactly-once entitlement VERIFIED.
- MK99/Xiaodou services and historical order settlement must continue
  unaffected throughout the transition.
