# CF Free: isolated Durable Object PBKDF2 offload candidate — 2026-11-19

## Background and scope
The active Production Worker sampled 2026-11-18 UTC HTTP 200 CPU P95 around 21.7 ms, and max around 46.3 ms. **The specific route is still unknown.** This candidate tests one suspected contributor (existing PBKDF2). The Cloudflare Workers Free HTTP entrypoint limit is 10ms CPU. A SQLite-backed Durable Object has separate CPU and usage accounting and supports Free; it normally has 30 seconds CPU per invocation. Verify with docs and real isolated Staging measurements before claiming the full API is Free-ready.

## Code
- `api/src/password-auth.ts`: a new `verifyLoginPassword` helper delegates only when `PASSWORD_VERIFY_DO_ENABLED=1`; default OFF preserves all original password login. RPC uses `getByName(user.id).verify(password,stored)`. Does not change sessions, role/frozen state, rate limiting, email, password schema, payment/entitlement logic.
- `api/prototypes/cf-free-password-do/src/index.ts`: separate Worker and SQLite-backed `PasswordVerifierDO` with internal RPC method. **No public verification API.** The HTTP entrypoint returns 404 and does not write password, pepper, hashes or customer data to storage/logs. It reuses the same existing `verifyPassword`, supporting 10k, 60k, 100k and 210k PBKDF2-SHA256 hashes.
- Missing, failing or malformed RPC response returns generic 503; **never falls back** to CPU-intensive local password verification when opted in. Existing optional legacy rehash is suppressed on the main login route while DO delegation is active.
- `PASSWORD_PEPPER` must be independently configured as an appropriately scoped **secret** in the DO Worker, equal to the existing application's pepper. Do not put the pepper in any committed files, logs, URL, or test data. Protect both Worker deploy pipelines and privilege scope. There is no shared public secret in HTTP payloads.
- `api/prototypes/cf-free-password-do/wrangler.jsonc` is only for isolated local proof. The script name has a local-prototype suffix; its `new_sqlite_classes` provision would create a new DO namespace **if deployed**, which this PR does NOT do. The Production API binding `PASSWORD_VERIFY_DO` to that class via `script_name` requires a distinct owner-approved release; no Production config changed.

## Test and acceptance
- Offline Node+esbuild mocks the DO runtime class without remote I/O. Exercises real 10k/60k/100k/210k PBKDF2 with known synthetic pepper; success/wrong/frozen; opt-in and opt-out; 503 on missing/bad binding; session retained; no rehash on parent Worker. No real D1 SELECT or mutation, email, payments or Cloudflare config changes.
- This is **not a Cloudflare CPU measurement**, only a compatibility and functional test. A real isolated Staging deployment and Worker-vs-DO CPU observation is mandatory before marking Free viable. The main Worker still performs PBKDF2 in registration/password resets and can exceed 10ms. All other successful routes must be profiled; DO per-day requests and duration quota must stay under Free.

## Operational gate
Do not merge or deploy if Worker/typecheck/test/bundle validation fails. Do not touch external provider or payment records. Do not add DO to Production or change plan without separate explicit approval.
