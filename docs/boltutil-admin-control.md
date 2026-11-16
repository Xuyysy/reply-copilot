# USDT admin emergency controls (BoltUtil)

This feature is **source-only** until separately approved and deployed. It does not configure secrets,
execute D1 remotely, turn on Production sales, or change MK99/Xiaodou.

## Design

- New authenticated routes: `GET/POST /v1/admin/boltutil/control`.
- Admin POST requires site singleton administrator, CSRF + web origin, recent password proof,
  reason (8–500 characters), stable operation ID, explicit confirmation and revision check.
- Each successful write is atomic and audited via existing `admin_operations` and
  `admin_audit_logs`. The first save inserts six ordinary `system_settings` keys;
  **no new D1 schema or financial migration** is needed for the switches.
- Master key: `boltutil_operator_enabled`; per-network keys:
  `boltutil_operator_trc20`, `_polygon`, `_bep20`, `_erc20`, `_solana`.
- **Staging** with no keys preserves the pre-existing Cloudflare-only enablement.
  **Production** with no keys is **OFF by default**.
- Public availability and new credit/subscription order creation enforce both
  persisted operator preferences and Cloudflare Worker gates. A paused network rejects
  new orders server-side even if the frontend sends a direct API request.
- Cloudflare ceilings `BOLTUTIL_ENABLED`, `BOLTUTIL_SCHEMA_READY`,
  `BOLTUTIL_PRODUCTION_CREATE_ENABLED`, merchant secrets, approved CNY-per-USDT FX,
  and the five per-network bindings cannot be overridden by administrator settings.
- Existing orders continue to be read, refreshed and securely settled by signed
  callback/provider-status verification while creation is paused.
- No pricing or merchant keys are editable in the web UI; no keys returned to the client.

## Production release blockers

Before **any** new Production orders: independently reconcile source against real
`release/production` (do not replace existing MK99/Xiaodou flow); separately authorize
Production D1 schema-only verification and migration; approve Production FX and
provider wallet/token/fee/callback setup; verify exact final SHA and build artifacts;
perform explicitly approved guarded deploy with Worker ceilings OFF; then obtain
separate approval for any chain activation and real-money E2E acceptance.

A completed CI suite or an enabled dashboard checkbox alone is never proof of live payment acceptance.
