# CF Free CPU diagnostics — response-status segmentation (2026-11-19)

Baseline: default-branch `main` SHA `a3b2272c94cc6a5a50e3c7f8df29abbe65bfdce9`.

## Actual account evidence (Cloudflare GraphQL only)
Full 2026-11-18 UTC day: 1,617,446 total D1 rows read; 35,458 rows written; 6,427 account Worker invocations. Multiple Production Worker versions ran that day. For the currently active Worker UUID `6ce50ec6-d7c2-405d-8a52-d5c8bec4e168`, 1,089 successful HTTP 200 requests had segment P95 21.693ms and max 46.257ms CPU. HTTP 204 (169 requests) had P95 1.582ms and max 2.968ms; 401 and 404 were similarly low in this sampled dataset. This is **not route attribution** or a complete-day result for this single Worker version. Workers Free remains **NO-GO** because the 10ms per-invocation CPU budget is unproven and observed maxima exceed 10ms.

The passive 10-second CPU profiles returned only runtime/root/idle samples; these cannot identify an application hotspot. Do not assume that password verification, AI generation, or billing code caused the high-CPU HTTP 200s.

## This operations-only enhancement
The existing manual account-wide CF Free readiness workflow queries the same read-only Cloudflare GraphQL Analytics, now additionally selecting `httpResponseStatus` from `workersInvocationsAdaptive` and reporting sanitized version-scoped CPU counts/maxima by HTTP status.

- No new API round trips, no new Worker request, no D1 SQL, and no configuration mutation.
- When `expected_worker_version` is supplied, the HTTP-status breakdown uses only that version; account-wide quota/CPU blockers still include every Worker and version.
- Group-level P95/P99 cannot be aggregated into an exact percentile, so report their **maximum among segments** with explicit labeling. No URL paths, user identities, query text, secret values, or payment details in output.
- Existing read-only Cloudflare workflow on `main` continues to require the owner actor, production GitHub environment and explicit workflow dispatch.

## Next gate
This makes it quicker to distinguish high-CPU HTTP success traffic from 401/404/error traffic. It **does not reveal the route**. Gather route-identifiable CPU samples before changing crypto, auth, provider, or billing logic. Real D1 SQL, real payment, Worker/Pages deploy and Free plan change remain separately gated.
