# Isolated Staging API Bootstrap integration (2026-11-17)

## Release basis and evidence
- Cloudflare read-only deployed Worker **reply-copilot-api-staging** current deployment `979ddd4a-da3c-412c-9568-3feee73e4ce5` (2026-11-16T03:00:19.715Z), version `ea96f683-eb16-43bb-b73a-78390b199ab8`, annotation `workers/commit_sha=80157d05d4793a02c557aea35ef60e9493768001`. Before any approved deployment, re-check the current deployed version and abort on drift.
- This branch starts from **that exact deployed source SHA**, not the older Chrome-extension V3 API tree.
- Cherry-pick only read-only Staging /v1/extension/bootstrap handler, one index router line, and local SQLite fixture tests from V3 PR #175 at `82366d4b7d674f94b3b4ef34c5b7b0acfc7e99a2`.
- Preserve every existing payment, subscription, unified-order, BoltUtil, Admin, cron, secret, route, binding, and production behavior from the actual deployed Staging version. No D1 remote queries (including SELECT) or schema changes.

## Scope and safe rollout
- Staging-only GET /v1/extension/bootstrap requires existing active extension bearer session (single sessionFor); web sessions 403, unauthenticated 401 and Production 404.
- Reuse existing accountState() for quota and subscription; response is no-store and read-only. Never issue generation, credit reservation, ACK, payment or edit entitlements.
- V3 Chrome extension candidate PR #175 uses this endpoint and on 404 falls back to three existing GETs. **Install/build that extension separately**; do not replace Chrome Store 0.3.11 or upload to Web Store.
- This narrow API build is a candidate only: **do not deploy without separate explicit Staging Worker approval**, exact source SHA full CI proof, staging Worker identity/domain/bindings and changelog review, and a fresh check that deployed Worker commit SHA has not changed.
- Existing `.github/workflows/deploy-staging.yml` only deploys Staging Pages, not API Worker. Never use it to promote this code.
- After explicit deployment approval: authenticated local Chrome Staging E2E + read-only endpoint security / quota checks, and Worker rollback to previous version if regressions occur. No Production deployment.
- Current source branch CI does not offer CI_LITE_PUSH; make one atomic final source commit with full Push CI, avoid redundant no-op commits/re-runs. Opening a PR on this older branch may incur an additional full CI run.
