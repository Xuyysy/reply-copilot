# PR16 second-round normal-path optimization

## Scope and evidence limits

Client baseline: `741b802811e672edbb4a8c7efb196647ced1ed12`.
Live Staging backend: `02a8d9f571b9873645212b46996253880b439b1c`, version
`ce71b30b-3948-4320-a1ef-00855bcce8eb`, deployment
`e54eca9c-8427-4c5d-9ca5-e0874b9f3e2e`. Backend bytes are unchanged between
02a8d9f and 741b802. Live settings were rechecked before candidate upload.
Production, Pages, online D1, provider settings and original installed extension
are outside this change. No migration or real model call.

User reports Qwen3.7-Flash, thinking off, 1200 max output, Hong Kong service region.
These settings are preserved, not independently queried from online D1. Existing
Cloudflare non-D1 telemetry has no generation invocation spans (invocation logs
are disabled); the inspected generation-path window returned zero samples.
That means unavailable latency evidence, not zero model/network latency.

## Confirmed implementation bottlenecks

After ACK the worker awaited receipt persistence, then separate history and usage
read/modify/write operations and another cached account-state read. Sending the
result early and leaving those writes running is unsafe for MV3 suspension.
Instead, history + generated usage are folded into the **existing awaited receipt
storage write**. There is no background fire-and-forget persistence. Pure bounded
reducers are idempotent by requestId; local writes share a Web Lock across trusted
extension contexts (in-process serialization fallback). Failed receipt writes
await the previous best-effort metadata path; a later replay can retry the commit.
Neither quota nor server ACK is deferred. Account labels use the already-loaded
cached state without another storage access; server authorization stays live.

The backend previously ran full expiry cleanup + request lookup both before
provider configuration and again during reservation. One account-scoped indexed
preflight now checks replay plus cleanup eligibility. Full atomic cleanup is
retained when an eligible candidate exists; direct reservation callers retain
old prechecks. The normal route passes a trusted server-only prechecked option.
If expiry crosses the preflight boundary and no credit lot is available, one
bounded cleanup/reservation retry runs; it never repeats an upstream call.
Reservation CAS, frozen-user checks, budget limits, ledger assertions, late-result
fencing and all recovery endpoints remain unchanged.

Before: Reply -> bind/precheck -> local context -> generation [cleanup/lookup
repeated twice -> reserve -> provider -> settle] -> ACK -> receipt -> separate
history/usage writes -> cached label read -> display/verified insertion.

After: Reply -> same bind/precheck/context -> generation [one indexed preflight
-> reserve -> same provider/settlement] -> same ACK -> one awaited combined receipt
+ history/usage commit -> cached label -> same display/verification.

## Repeatable measurements (synthetic, not real X/Qwen)

20 measured samples/version, two excluded warmups. The client benchmark alternates
versions, keeps the same 35ms provider fixture, 80ms HTTP delay, prompt input and
composer verification. Cold account precheck retains three parallel GETs; warm
account normal generation has generate + ACK only. Recovery GETs remain zero.

| Metric | Baseline mean / P50 / P90 ms | Candidate mean / P50 / P90 ms |
|---|---|---|
| Client click -> verified composer | 474.15 / 473.75 / 476.06 | 462.06 / 461.85 / 463.30 |
| ACK end -> verified composer | 106.49 / 105.84 / 108.57 | 94.35 / 94.19 / 95.00 |
| Provider fixture alone (inside generate HTTP) | 36.01 / 36.13 / 36.21 | 36.09 / 36.16 / 36.20 |
| Separate actual quota preflight + reservation, 8ms synthetic D1 RTT | 100.41 / 100.33 / 101.33 | 54.34 / 54.58 / 55.20 |

Quota benchmark uses the actual full-schema isolated SQLite state machine. D1
round trips decrease 11 -> 6; this is not a measurement of live D1/network latency.
The separate backend saving must **not** be added to the client benchmark: its
provider/D1 boundary is synthetic and does not execute this quota module.

Both normal client variants: 20/20 success, one ACK/debit/insertion per request,
identical system/user prompt hashes. Recovery comparison: 8/8 per variant (half
local pending retained, half lost): permanent first provider -> explicit skip ->
three successful replies, three debits, no normal-path recovery queries thereafter.

Local workerd/D1 with 1000 and 10000 historical requests: preflight rows_read=2,
rows_written=0 for each, no new index. Query plan uses the unique
(user_id,request_id) lookup and `ai_requests_status_idx (user_id,status)` for
eligibility; no historical request table scan. State-changing SQL is unchanged.
Pending records can still increase work in the exceptional path; no constant-time
claim is made for arbitrarily many outstanding reservations.

## Measurement export and user acceptance

Staging side panel -> “Staging 匿名性能测量” -> 开始记录. Use normal X replies,
then 导出报告, then 停止记录. Export contains only allowlisted aggregate timings,
outcome counts and sample counts: no text, account, URL, requestId, credentials or
raw response. No generation is triggered by any report control. Disabled by
default; extension reload disables it; MV3 restart may clear samples. Failure/
cancelled samples are counted separately, not mixed into success percentiles.
Worker auth/replay/config/reserve/model/DNS/finish and client delivery persistence
spans are included when present. Missing spans mean unavailable, never zero.
Cold/warm account runs should be reported separately. Model is inside Worker HTTP;
parallel local context reads must not be summed. Real-X mean/P50/P90, real model
and network latency, actual token usage and <3s target remain unverified.

## Model/cache/placement findings, no configuration changes

The system prompt starts with static instructions but places dynamic Voice Profile
before much of the remaining static rules. A future static-prefix reorder might
improve implicit caching, but it changes model input: keep it out of this release
until independent quality A/B. No trimming, explicit cache billing, token-limit,
thinking, model, budget or price changes. User-reported thinking is already off.

[Alibaba Context Cache](https://help.aliyun.com/zh/model-studio/context-cache)
documents automatic common-prefix caching, with >=1024 tokens necessary but not
sufficient and hits not guaranteed; model/region support must be verified before
assuming benefit. [Cloudflare Placement](https://developers.cloudflare.com/workers/configuration/placement/)
accounts for both backend and request-forwarding latency. Hong Kong provider
region alone does not justify changing Placement; live placement remains `{}`.
[Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
keeps an asynchronous response channel open until sendResponse; all required
local writes here finish before that response. No keepalive trick is added.

## Validation and release gate

- Full npm test: 802/802 pass, zero failures/skips.
- API and Web TypeScript: pass; Staging Worker dry-run: pass.
- Isolated real Chrome extension smoke: pass for dashboard/settings/reload sync,
  stale-request rejection; toolbar action unsupported by that CDP target, not
  claimed validated. No real X, no paid generation.
- First full run had one Chrome-profile cleanup race (ENOTEMPTY), not a product
  assertion failure; bounded cleanup retries increased and full suite rerun green.
- New tests prove awaited receipt durability, restart replay dedup, concurrent
  selection/history preservation, awaited storage failure fallback, scoped
  cleanup with ample credits, zero duplicate normal prechecks, real workerd plan,
  and diagnostic controls that never generate AI.

Reproduce after installing dependencies and freezing baseline worktree:

```sh
git worktree add --detach /private/tmp/reply-copilot-pr16-round2-before 741b802811e672edbb4a8c7efb196647ced1ed12
node scripts/benchmark-pr16-fast-path.mjs --baseline /private/tmp/reply-copilot-pr16-round2-before --out /private/tmp/pr16-round2-client-benchmark.json
node scripts/benchmark-pr16-round2-worker.mjs /private/tmp/reply-copilot-pr16-round2-before
PR16_BENCHMARK_BASELINE=/private/tmp/reply-copilot-pr16-round2-before node scripts/benchmark-pr16-recovery.mjs
npm test
npm --prefix api run typecheck
npm --prefix web exec tsc -- --noEmit -p web/tsconfig.json
```

Install only into the original Staging path using the supplied hash-checked
installer; do not uninstall or clear storage. Backup freezes installed 741b802.
Rollback restores that exact folder, reloads the existing Staging extension and
refreshes X. Backend rollback target is ce71b30b above; code rollback does not
reverse D1 state. No database migration or online SQL in this release.

Production proposal is deferred until user real-X measurements and recovery/
draft/continuous-reply acceptance. No Store update or PR merge.
