# CF Free: isolated workerd request CPU profiling harness (2026-11-20)

## Scope

This tool runs the current API entrypoint under local Miniflare/workerd, using a fresh isolated D1 initialized only from checked-in migrations and synthetic accounts/password hashes. It never connects to Production or Staging, never sends real mail or AI requests, never queries remote D1 (not even SELECT), and does not modify any Cloudflare settings. Every Worker outbound fetch is blocked. It is an investigation tool, never a CF Free eligibility gate.

The experiment exercises nine labeled scenarios: health, me, usage, entitlements, extension bootstrap, PBKDF2 login at 10k and 100k iterations, mock AI generate, and delivery ACK. It fails if a route does not return HTTP 200, if the requested work factor cannot be verified, if an outbound call occurs, or if ACK credits do not reconcile exactly.

## Commands

From repository root, after installing existing locked API dependencies:

    npm --prefix api ci
    node --test api/tests/cf-free-workerd-cpu.test.mjs
    node api/scripts/cf-free-workerd-cpu.mjs --samples 3 --warmup 1
    node api/scripts/cf-free-workerd-cpu.mjs --samples 3 --warmup 1 --profile

With --profile, the runner uses the **local workerd V8 inspector** and requests a separate V8 profile for each route category. It prints only category names and sanitized function names (up to eight). If the inspector cannot connect, the run fails rather than silently treating no samples as 0ms CPU. Insufficient profiles are labeled INSUFFICIENT. The opt-in profiler is not connected to Production.

Without --profile, the runner reports only Node->workerd dispatch round-trip wall times (P50/P95/max). These include local D1 I/O, scheduling and overhead, and are **not** per-request Worker CPU times. Even with --profile, samples reveal function hot spots rather than an exact per-request Free-plan CPU percentile. A successful report has freeCertified=false and productionHotspotsConfirmed=false.

The CLI caps runs to 1–4 samples and 0–1 warmup for each case to respect login rate limits and keep the test non-invasive. All data is synthetic; a successful generation/ACK pair changes only isolated credit balances.

## Follow-up and evidence

Use local CPU samples to choose a specific optimization candidate. Then run the existing full CI and exact-SHA protected build. To determine actual Production route over-limit counts, separate real invocation-level evidence or representative sampled profiles are needed; this harness is deliberately not a substitute.

Keep Production Workers Paid. No remote D1 SQL, plan change, auth architecture change, payment call, real account creation, release or extension publication is authorized by this tool.

Reference: https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/
