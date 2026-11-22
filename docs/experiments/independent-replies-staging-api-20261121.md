# Staging API independent Reply reservation candidate (2026-11-21)

Parent: EXACT deployed staging API source SHA d7a7a62de0430e9e2c8ea870067f55ed7f0e96c1, Cloudflare deployed version 489d5ea0-e476-41a5-bd71-a53fe67451a0. Abort any future deployment on source/version/binding drift.

Minimal patch: allow a new different requestId to reserve in parallel with older generating requests. Removes cross-request SQL NOT EXISTS gating and its conflict fallback. All subscription, permanent credit, user auth, per-request idempotency, global budget, ACK and cleanup logic is preserved.

This branch deliberately does NOT import newer Production API sources, admin, subscription, payments, D1 migrations or configuration. No remote D1 read/write, no deployment, no Secrets. Full source-SHA CI must pass before separately authorized Staging Worker deployment and real Chrome A/B.

The corresponding browser change (independent fast-post-switch without waiting for old recovery/abandon) must be tested separately against current 0.3.12-derived Staging extension. Do not merge this source tree wholesale into release/production.
