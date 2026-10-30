# Generation-to-composer measurement and low-risk optimization

Scope: independent `codex/generation-to-composer-performance`, based on Pages production `98155453560209f3c77de069c34735fccb444a65`, advanced to published privacy correction `e9125d7d7a90acfcb06ed3dfc02c28e7ecb2d8fa` (Worker/extension baseline `2d58c42e`). No deployment, real model calls, installation replacement, financial writes, or model changes.

## Approach

Measure locally with opt-in, bounded, allowlisted timings. Maintain separate monotonic clock domains: content click-to-verified timeline, background/client durations, Worker durations returned only when its independent diagnostics flag is enabled. No content, identity, URL, request ID, token counts, keys or upstream text in diagnostics. Diagnostic failure must never fail a draft.

Use controlled local latency fixtures for causal comparison, explicitly not Production percentiles. Keep full prompt bytes, three-reply parsing, fresh owner check, delivery coordinator persistence, independent ACK, quota/ledger processing and the 80ms editor verification unchanged.

## Implementation tasks

- [x] Establish pre-change executable baseline for preferences/account, history context, background settings/label, DNS A/AAAA. Report full fixture click-to-editor times and stage percentiles with fixed workloads.
- [x] Add disabled-by-default timing collector, bounded aggregation, privacy tests, content/background/hosted/Worker timing seams. Distinguish incomplete/cancelled/failed/successful samples.
- [x] Parallelize independent preflight reads with session identity checks after awaits; share one history snapshot without changing prompt content; parallelize DNS A/AAAA while validating every answer and preserving the original timeout/CNAME/address-pin/redirect guards. Overlap post-ACK bookkeeping and label reading without making local writes fire-and-forget.
- [x] Regress cancellation, delayed responses, draft safety, ACK failure/replay, account isolation, DNS private/mixed/error/CNAME/changed-address cases; run full tests, type checks and isolated builds.
- [x] Document measured mock before/after and outstanding real-client sampling, review diff/secrets, commit/push independent branch, update both Notion project pages with accurate un-deployed status.

## Deferred

No endpoint/DNS caching, no prompt shortening without paid quality comparison authorization, no streaming, no cached replacement for fresh owner identity, no early draft exposure before ACK. Production and real X E2E remain unmeasured in this task; user-operated Staging sampling requires separate deployment/call authorization.

## Final status

Local implementation and Mock comparison completed; real-client sampling remains pending separate Staging deployment/install/call authorization. 698/698 final tests passed. User-directed public privacy/FAQ corrections were separately deployed to Pages during this task; no performance code was deployed. The existing table test now waits for its controlled checkbox commit instead of immediately reading after mouse dispatch. See the performance report for limits, evidence and outstanding validation.
