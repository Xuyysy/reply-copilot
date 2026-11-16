# BoltUtil five-chain read-only reconciliation and exception response

This feature ships as **source-only Draft PR #150** until a separately
authorized Production release. It does not settle, refund, grant entitlements,
edit database rows, contact the provider, or perform on-chain verification.

## Read-only administrator endpoints

- GET /v1/admin/boltutil/reconciliation?scope=attention&network=all&limit=25
  Optional cursor: \`{created_at}.{order UUID}\`, in descending order.
- GET /v1/admin/boltutil/orders/{order UUID}/evidence

Both require the singleton administrator's authenticated web session.
The list is limited to 50 entries per page and computes order-count metrics,
not revenue. USDT micros never flow into the CNY financial ledger.
If BoltUtil schema readiness is OFF, the report is empty without accessing
BoltUtil order tables; individual evidence lookup fails closed.

Server-computed exception reasons include: manual review; paid but unapplied;
paid without a matching stored digest; paid credit order with inconsistent underlying paid/credited flags;
paid credit order missing an award ledger row; paid subscription missing its period/upgrade record; expired open
invoice; and unknown state. The alert order intentionally prioritizes manual
review and applied state discrepancies before secondary checks.

The detail view can show up to 25 *stored* provider event records, whether
their digests match the order network/tx hash, and the count of linked
permanent credit batches or subscription periods/tier changes. These reflect
a historical data-processing trail, **not independent signature verification**
or chain settlement confirmation. No raw merchant keys, response signatures,
or provider webhook bodies are exposed.

## Operational response

Treat an alert as a prompt for investigation, not a basis for sending
credits, editing historical payment status or issuing refunds. Keep both
MK99 and Xiaodou untouched. Signed webhooks and existing buyer-initiated
verified settlement remain on their established server paths even if the
new-order master flag is OFF.

The original 0031 Production D1 schema proposal is unchanged; this feature
requires no extra D1 migration. It may only be deployed after a separately
approved guarded exact-SHA release, Production D1 readiness and owner
release approvals. If the actual live database does not contain the
BoltUtil objects, leave schema-ready OFF.
