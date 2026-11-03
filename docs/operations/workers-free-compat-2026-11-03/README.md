# Workers Free compatibility — local-only Draft candidate

Base: deployed Production `1070dc79f0048ebe719055e1d8c925aed76c73f3`, version `ce100ea7-8170-4f3b-8a77-d5de573f1cad`. Branch `codex/workers-free-compat-20261103`.

## Verdict

**A: Not certified safe for Workers Free.** Current authentication and observed CPU tail lack reliable10ms headroom. **B:** password derivation is the largest reproduced local hotspot; supported210k legacy verification exceeds10ms even locally,100k has little margin, and online CPU has no route attribution in current observability. Historical aggregate and expiry reads grow independently of ordinary request count. **C:** implemented a small exact-result monthly cost query improvement; added reproducible profiling, read/write/capacity and expiry-growth evidence. No authentication or financial transaction rewrite. **D:** for the current architecture and reliability/security requirements, retain Workers Paid as an operational cost until the blockers are resolved and measured on the edge. This does not assert every request needs more than10ms or that all future architectures require Paid.

No Production/Staging deployment, configuration, Secrets, D1 SQL, migration, subscription, Pages, extension or real model/payment/email/browser operation occurred in this task. Cloudflare access was readonly non-D1 Analytics and existing log-field inspection. All benchmarks use synthetic schemas/data and intercepted outbound calls. No financial records were read from an online database.

## Observed online evidence and limits

`online-observations.json` contains sanitized aggregates only. New Production version observation window2026-11-03 03:34–04:10UTC returned115requests,0platform errors, CPU P50/P90/P95/P99=1.828/4.656/11.801/17.587ms; wall P50/P90=36.128/100.128ms. Waiting is not CPU. Workers Analytics dimensions contain status/script/version/colo/time, **no URL or route**. Existing log keys did not expose route-level CPU fields; scheduled dataset returned no records for the checked window. GraphQL rate budget temporarily blocked queries and later recovered. No route attribution was invented and no new online logging was enabled.

Normal full UTC days, excluding Nov2's audit incident:

| Day | Prod requests | Staging requests | Combined D1 reads | Combined D1 writes |
|---|---:|---:|---:|---:|
| Oct31 |4,129|2,125|1,270,759|18,246|
| Nov1 |4,815|1,973|1,909,399|29,418|

These are observed past workloads, not current/future forecasts. No short postrelease window was used as a reliable day forecast.

## Local CPU methodology

`profile-workers-free.mjs` builds the actual API entry plus **test-only** routes in a separate ephemeral workerd. All21 migrations are restored locally; sessions, passwords, keys and signed multipart callbacks are synthetic. Outbound service accepts only stubbed provider, DoH, Turnstile and email calls; everything else fails. No real browser is used.

CPU profiling preceded runtime optimization. Initial workerd tail probing returned cpuTime=wallTime=0 even for a busy loop, so those fields were rejected as measurements. The final harness uses the local inspector V8 Profiler (requested100µs sampling),20samples/path, saved cold/warm observations and raw `.cpuprofile` files under `/private/tmp/xrh-free-reference-final` / `xrh-free-candidate-final`. Reference and candidate use the same harness with old/candidate cost SQL. Earlier smoke runs caught incomplete mock contracts and Node/FormData transport incompatibilities; those fixtures were corrected without touching production security checks.

V8 sampled active time is **not edge billed CPU**. It has sampling/scheduler/native-operation limitations, includes local SDK overhead, and zero samples mean below resolution rather than zeroCPU. The50ms wait control yields roughly52ms wall and near-zero sampled activity, demonstrating that the report separates waiting. Do not certify Free or claim reliable P95 from20local samples. Full per-path numbers are in `cpu-table.md` and both CPU JSON files.

Key matched local P95 observations (reference→candidate sampled active ms):

- Password100k:7.911→8.068; supported legacy210k:14.081→14.008. DeriveBits dominates both. Hash parameters/pepper/constant-time comparison unchanged.
- Registration100k:8.697→8.681; little headroom for cold/edge variability.
- Managed generation6.343→6.483; deliveryACK4.729→1.448; order read0.985→1.210; first signed payment notification2.640→3.674; duplicate1.869→1.472. Those implementations did not change; the varying values illustrate noise, not claimed optimizations.
- Dashboard4.822→2.750 sampled ms, wall5.237→4.453ms. Only SQL work changed; exact rows-read reduction below is stronger causal evidence than these small CPU samples.
- Cron handler body1.366→1.195ms under a local HTTP wrapper, mostly non-expiring data. This is not a real scheduled edge CPU sample or large expiry/delete batch certification.

No HMAC key/authorization cache was added:20HMAC operations were sub-millisecond locally and not the dominant hotspot. No password cost, signature verification or financial assertion was weakened. Existing100k PBKDF2 is below OWASP's current600k-SHA256 recommendation; further reduction is not an equivalent performance fix. Migration to different authentication/compute architecture would need separate security and cost design.

## Implemented runtime change: cost history preaggregation

Only `api/src/ai-cost-dashboard.ts` and new `api/src/ai-cost-queries.js` affect deployed code. Old query joined every usage row to immutable config-version metadata; candidate first groups by configID/version/upstream-model, then attributes and reaggregates. Active model/key-present metadata and settled/reserved daily budget remain fresh. No caching or state persistence added. Cost fields, model history, failed/estimated costs, UTC bounds and output ordering are identical.

Isolated real workerd fixture:70%managed,10%unresolved,10%legacy,10%mock, two versions, shared model aliases, zero-token/nonzero estimated cost. These assumptions are explicit and not extracted customer data.

| Usage rows | Old reads | Candidate reads | Writes |
|---:|---:|---:|---:|
|2,000+edge case|5,407|4,015|0|
|20,000+edge case|54,007|40,015|0|

All result rows exactly equal. Plan keeps `ai_usage_costs_created_idx` time-range SEARCH; moves config primary-key lookup after `CO-ROUTINE grouped`, reducing repeated lookups. Temp grouping remains. No index/migration/write cost added. Less-managed workloads may benefit less; every-row unique model/version groups would reduce benefit. It still reads the in-month history and is not an O(1) dashboard.

## Expiry and financial transaction findings

`free-expiry-growth.test.mjs` measures unchanged real quota functions under isolated workerd with account/batch invariants and duplicate-release assertions. One expired request:

| Synthetic accounts | First reads | First writes | Duplicate reads/writes |
|---:|---:|---:|---:|
|100|742|15|1 /0|
|2,000|14,042|15|1 /0|

Global account/batch assertion causes growth even for scoped expiry. Financial SQL, including atomic batches, remains unchanged. Existing full regressions cover concurrent expiry, repeatedACK, late responses, refund holds, rollback on inconsistent budget and account isolation. Removing global checks blindly would be unsafe. A next change should identify bounded candidates/affected accounts, use unique transactional claims (timestamps alone are not ownership), preserve all affected-row invariants, and separately test same-time/concurrent/no-op races before considering rollout.

## Read/write workload and cache

`measure-free-workload.mjs` uses strictly sequential test-only D1 metadata wrapping. Binding identity is preserved so the real30s WeakMap cache works. Missing metrics cause failure; they are never silently counted as0. Metered runs are separate from CPU profiling. Five real-code stub-provider generate/ACK/duplicate cycles at both history sizes all debit once and clear reservations:

- Managed generation46–47reads,26steady writes (31first daily setup); ACK33reads/16writes. A normal cycle is ~79–80reads/42steady writes; duplicateACK3reads/0writes.
-1000cost/ledger history: dashboard3031cold/2028warm reads.
-20000history:60031cold/40028warm reads. These fixtures have one account and no preseeded ACK request history; real monthlyACK/user/order counts add reads, not included silently.
- Production/Staging quotas are shared. Cache only reduces historical counters per isolate for30s; cold starts, multiple isolates or requests spaced>30s can all miss. Monthly costs/ACKs/auth/model/budget stay live. Repeated admin refreshes can exceed5Mreads/day even after this patch.

`free-capacity.mjs` is an explicit scenario calculator with measured generation coefficients and labelled assumptions for dashboard growth, other endpoints, per-isolate misses, expiries, Cron and Staging. It rejects impossible/negative inputs and always declines CPU certification. The number-of-users input alone does not predict traffic.

| Illustrative inputs | Daily reads | Writes | Worker requests | Daily count fit |
|---|---:|---:|---:|---|
|23users,250generations,20cold dashboards;7500usage/10000ledger rows|1,002,355|29,580|3,520|yes, CPU still blocked|
|200users,1000generations,100cold dashboards;30000usage/50000ledger rows|14,342,410|61,080|5,100|read limit exceeded|
|1000users,5000generations,100cold dashboards;150000usage/250000ledger rows|70,290,410|229,080|13,100|reads/writes exceeded|

Examples include default assumed230kStaging reads/11k writes,100kCron read/5k write reserves, other-request and expiry assumptions; see calculator for every parameter. They are neither real observed daily totals nor reliable forecasts. All rows can change with new models, retry mix, batches, audit traffic and retention behavior.

## Next-stage aggregate design (not implemented)

If exact historical reports must be O(1), use versioned daily UTC summary rows keyed by day/configID/version rather than weakening financial reads. Requirements before any migration:

1. Cost summaries update only when unique `(user_id,request_id)` usage insertion wins, in the same atomic D1 batch; include failed/estimated costs. ACK-count summaries update only with the winning delivery confirmation token. Provider version fixed at reservation.
2. Historical initialization uses a fenced consistent snapshot/epoch plus bounded cursor batches; track live deltas during backfill so records are counted exactly once. Do not use unbounded online scans or overwrite balances.
3. Mark epoch ready only after bounded totals/reconciliation checks; fail closed or retain the current exact query on incomplete state. Do not silently serve a partial summary as exact.
4. Recovery/rebuild uses an independent new epoch, idempotent progress and compare-before-switch. Transaction failures roll back summary and original mutation together. Legacy/unconfirmed requests follow the established ACK-evidence policy.
5. Test concurrent cost/ACK/replay/cleanup/retention/backfill races and fault injection. Daily cost budget remains authoritative and uncached. UI may label/cache noncritical summaries only with explicit freshness semantics.

No summary table, migration, historical initialization or financial write change is included here.

## Reproduction and verification

From this branch with dependencies installed:

```sh
FREE_PROFILE_REFERENCE_SQL=1 FREE_PROFILE_SAMPLES=20 FREE_PROFILE_OUT=/private/tmp/free-reference node api/scripts/profile-workers-free.mjs
FREE_PROFILE_SAMPLES=20 FREE_PROFILE_OUT=/private/tmp/free-candidate node api/scripts/profile-workers-free.mjs
FREE_COST_REPORT=/private/tmp/free-cost.json node --test api/tests/free-cost-history.test.mjs
FREE_EXPIRY_REPORT=/private/tmp/free-expiry.json node --test api/tests/free-expiry-growth.test.mjs
node api/scripts/measure-free-workload.mjs
npm test
npm --prefix api run typecheck
web/node_modules/.bin/tsc --project web/tsconfig.json --noEmit
```

Full tests/types/build and independent review results are recorded in the Draft PR. Local-only Worker dry-run bundle was scanned and contains no `__profile/`/synthetic-profile hooks. No environment is ready for deployment on the basis of this report alone.

Paused checkpoint: final full suite736/736,0failed/0skipped; API/Web types and local dry-run passed. Independent review found no Critical/Important issue; requested empty-history/UTC tests were added before this final run. New Draft PR creation is pending because the user paused; see HANDOFF.md.

Official references: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 pricing/quotas](https://developers.cloudflare.com/d1/platform/pricing/), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2). Free daily D1 quota resets00:00UTC/08:00Asia-Shanghai;10msCPU is per request, not a percentile budget. No subscription change is recommended automatically or performed.
