# Cold-start V3 Production API release candidate — NOT DEPLOYED

Parent release/production: 66ab31f26785e221571b7382713b79745fa827e8. This branch intentionally contains **only** read-only GET /v1/extension/bootstrap, router wiring, fixture tests and this record.

- Staging code was validated in PR #175, Staging API deployed from d7a7a62de0430e9e2c8ea870067f55ed7f0e96c1.
- Extension bootstrap supports authenticated session kind=extension only in Staging or Production; Development 404. Existing accountState() ensures frozen/exhausted/quota/subscription decisions use live D1. Returns no-store and existing CORS; does not spend/hold credits.
- Web sessions 403 and anonymous/revoked sessions 401.
- Existing Production 0.3.11 users continue using /v1/me, /v1/entitlements, /v1/usage until Chrome 0.3.12 is separately approved and published.
- Do not merge or deploy before exact-SHA full CI and independent production-build artifacts from release/production; release/production is not the same code lineage as the Chrome 0.3.11 Web Store upload candidate.
- Production Worker live deployment version must be independently re-read; verify source/config/secret/D1 preservation before any Worker deploy.
- No Production or Staging D1 remote SQL (including SELECT), no migrations, no payment/entitlement policy changes, no Pages or Chrome Web Store publish. Smoke-check only unauthenticated /health and /v1/extension/bootstrap after any approved deploy; authenticated E2E must be separately performed.
