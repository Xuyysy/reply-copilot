# Read-only admin subscription label hotfix — 2026-11-18

Baseline `e28a8782197d19af2c44761f668189f460369f18`. A verified paid BEP20 BASIC subscription has an active period and working consumption, but the administrator's `effective_status` calculation required **CNY payment transaction evidence**. A crypto subscription has no such transaction, so the list falsely displayed `expired_or_unverified`.

Update only `GET /v1/admin/subscriptions/users` to use the same signed BoltUtil proof as the authoritative subscription account and generation reserve paths, alongside unchanged fiat proof. Require matching user/order, paid+applied timestamps, subscription product, network and tx hash, SHA256-backed event, and sufficient USDT. Do not even query crypto tables outside staging/production or when `BOLTUTIL_SCHEMA_READY` is not 1.

Tests cover unverified paid, valid BEP20, held, underpaid, expired period, incomplete schema and exact daily used/reserved remaining counts. No financial writes, remote D1 SQL, customer balance changes, paid/refund status changes, schema migration or permission bypass. Preserve the Production ¥6.67 USDT quote bindings. CI and separate owner-approved protected Production Worker release required.
