# CF Free HTTP + Durable Object component readiness gate (2026-11-20)

## Scope and current status

**NO_GO by default.** This is an offline, aggregate-only complement to `scripts/cf-free-readiness.mjs` (account Workers / D1 read-only analytics) and the synthetic workerd V8 comparison from PR #214. It never contacts Cloudflare, executes remote D1 SQL, creates/updates resources, changes billing, or deploys a Worker. It does not handle passwords, secrets, identifiable paths or raw invocation logs.

Cloudflare documentation as checked on 2026-11-20:

- [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/): 10ms CPU per HTTP request, 100,000 Worker requests/day, 50 external subrequests/invocation and size limits.
- [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/): DO CPU is separately documented as **30 seconds default**, while the page also says Workers-plan limits apply. **Do not assume this ambiguity confirms any exact limit for our Free account** without an isolated cloud validation.
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): only SQLite-backed DOs are available on Free; DO requests 100,000/day and compute-duration 13,000 GB-s/day, with storage quotas. A DO RPC call is a DO request.
- [Wrangler limits](https://developers.cloudflare.com/workers/wrangler/configuration/): local Miniflare/workerd does not enforce the cloud CPU limit. V8 sample percentages are **not milliseconds**.
- [Existing local DO proof](https://github.com/Xuyysy/reply-copilot/pull/214): 100k stored PBKDF2 derives move out of HTTP Worker and into DO, but overall work and request wall time remain similar.

## Local operator usage

After fetching aggregate-only JSON produced by the existing read-only `cf-free-readiness.mjs` script, and optionally the sanitized local DO comparison JSON:

```sh
node scripts/cf-free-component-readiness.mjs \
  --analytics ./cf-free-readiness.json \
  --local-do-proof ./cf-free-do-proof.json \
  --expected-version <verified-prod-worker-version>
```

Optional `--do-usage ./aggregate-do-daily.json` may include **only aggregate fields**, never IDs or credentials:

```json
{"cloudflareReadOnlyAggregate":true,"day":"2026-11-19",
 "rpcRequests":100,"durationGbSeconds":25,"sqliteStoredBytes":0}
```

Even if all supplied numbers are below their Free quotas, their source authenticity and version matching are not provable from a local file. Thus this tool reports `NO_GO` and exits with code **2** intentionally. The caller must never treat successful local profiles or unsigned external reports as a production downgrade approval.

## Missing evidence before any Free change

1. Version-pinned **deployed HTTP Worker** route-level Cloudflare CPU measurements with enough coverage, including login, AI Generate, delivery ACK and admin routes. Cloudflare adaptive analytics alone is not exhaustive, and existing Production invocation path telemetry is absent.
2. Genuine isolated cloud validation of **DO CPU limit applicability on the intended Free plan**, while retaining 100k/210k PBKDF2 compatibility and verifying errors/latency.
3. Complete UTC-day account-wide Worker requests, D1 rows, DO RPC requests/GB-s/storage, and Workers/DO script size and limits; account for other projects too.
4. Reviewed binding/pepper provisioning, session failure behavior and rollback. No downgrade without explicit operator authorization.

**Do not** turn on `PASSWORD_VERIFY_DO_ENABLED` in Production, lower hash work factors to 10k, deploy a DO namespace, change D1 or modify billing from this script.
