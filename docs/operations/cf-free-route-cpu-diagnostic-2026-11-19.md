# Route CPU attribution for CF Free — read-only preparation (2026-11-19)

## Verified current gate

Live Production Worker `reply-copilot-api-production` uses Cloudflare Workers Paid/standard.
Cloudflare Worker settings show `observability.enabled=true`, `observability.logs.enabled=true`,
`redact_query_string=true`, but **`observability.logs.invocation_logs=false`** and
`observability.traces.enabled=false`. The existing WorkersInvocationsAdaptive dataset
provides script/version/status and CPU but **not the request path**. Real-time read-only
Cloudflare telemetry key discovery returned no `$workers.cpuTimeMs` or
`$workers.event.request.path` fields for logged invocations; aggregate logs
query over the latest hour returned zero events. This proves **missing
invocation-level evidence**, not that over-limit invocations are absent.

## New read-only diagnostic

`scripts/cf-free-route-cpu.mjs` can run with an authorized Cloudflare API token
that has read-only Workers Observability telemetry permission:

`node scripts/cf-free-route-cpu.mjs --minutes 60 --expected-version <active-worker-version-UUID>`

It queries only Cloudflare Workers Observability telemetry. No D1 queries or
SQL, no data writes, no deployments, no password/hash/financial data reads.
Before the grouped query it checks that CPU, path, script, event-type and
version keys exist; missing keys return **INVOCATION_LOGS_UNAVAILABLE**, not
a misleading zero-CPU result. Report is **only fixed route categories**:
auth, ai_generate, admin, account_reads, orders, etc. It does not emit raw
request paths, IDs, URLs, query strings, request bodies, timestamps per user
or secrets. It filters only HTTP fetch invocations with **CPU > 10 ms**
for the named Worker version and returns estimated counts, maximum CPU and
the highest P95 of the *already over-limit samples* in each raw-path group.
That P95 is NOT the overall route-category P95. Sampling and the 1,500-path
result cap are explicitly labeled; this diagnostic can never certify Free.

## Enabling attribution requires a separate explicit release authorization

Do not silently enable it in `api/deploy/production.wrangler.json` or modify
current Worker settings. To collect enough real route CPU data, an operator
would need to approve a **short-lived, minimally sampled** invocation log
configuration, with query-string redaction retained, Cloudflare Observability
retention/cost/privacy reviewed, and a rollback plan. Production route paths
may contain order/user identifiers inside path segments even with query strings
redacted; the diagnostic only outputs redacted categories, but Cloudflare
would still ingest the original invocation event. Existing Production is
not modified by this PR.

Reference: https://developers.cloudflare.com/workers/observability/query-builder/
