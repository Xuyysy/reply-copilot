# Investigation delivered — 2026-11-03

Resume branch `codex/workers-free-compat-20261103`, base deployed1070dc79f0048ebe719055e1d8c925aed76c73f3. Linked worktree `/private/tmp/reply-copilot-workers-free`; if unavailable, recreate from remote branch. Resumed at the user’s request; publication of the local-only candidate is complete. No rollout is authorized.

## Completed and saved

- Readonly non-D1 Cloudflare Analytics/log capability inspection. No URL/route CPU dimension; existing logs lacked usable route CPU, scheduled dataset empty. Sanitized normal-day/CPU evidence committed in this directory. No online D1 SQL or online mutations in this task.
- Isolated workerd profile harness,20samples/path: session, usage,100k/210k login, registration, legacy/managed generation, ACK, admin, packages, orders, real RSA synthetic first/duplicate notifications and Cron body. Separate50ms wait control. Local V8 samples are not edge billed CPU. Reports and comparison table included; raw `.cpuprofile` artifacts also saved privately on the Mac.
- Runtime candidate limited to `api/src/ai-cost-dashboard.ts` and new `ai-cost-queries.js`: group immutable usage versions before joining attribution metadata; exact outputs retained. No auth/hash/crypto/quota/financial transaction change, no migration/index/cache added.
- Isolated mixed-history SQL reads5407→4015 at2k and54007→40015 at20k;0writes, same full result. Edge tests cover empty history/UTC boundaries. Financial expiry analysis intentionally leaves core transactions unchanged:742reads at100accounts→14042 at2000; duplicate1read/0writes.
- Metered full managed generation/ACK costs ~80reads/42steadywrites, duplicateACK3reads/0writes. Dashboard cold/warm3031/2028 at1khistory,60031/40028 at20k. Synthetic fixtures have no full historical ACK request population; capacity model accounts separately for confirmed requests/users.
- Capacity calculator and tests distinguish assumptions, actual normal full days and synthetic measurements. No reliable day forecast from short-window linear extrapolation. Nov2 audit incident excluded from normal baseline.
- Full final tests **736/736**,0failed/0skipped (`/private/tmp/xrh-free-reviewed-tests.log`), API/Web types passed, local-only Worker dry-run passed. Bundle `/private/tmp/xrh-free-worker-bundle` scanned: no profile/mock hooks.
- Readonly independent code review: no Critical/Important issues; minor empty/UTC coverage request implemented and full suite rerun. Runtime SQL result equivalence confirmed.

## Conclusions so far

Not certified safe for Workers Free. Supported210k verification sampled~14ms;100k ~8ms lacks reliable margin. Online overall CPU P95~11.8ms, no route attribution available. Password work factor unchanged (100k new /210k supported); HMAC cache rejected as immaterial. Paid remains recommended for reliable current architecture until CPU and growing statistics/expiry costs are resolved. Current100k is below OWASP SHA256600k guidance; do not treat lowering it as an equivalent optimization.

## Delivery and follow-up

- Runtime checkpoint: `7f766881df568c3d3b18f0f429077730c6cda018`. Resume checks confirmed clean worktree, matching remote branch/base, saved 736-test result and private evidence archive checksum. No business code changed after those checks.
- New [Draft PR #11](https://github.com/Xuyysy/reply-copilot/pull/11), targeting `fix/d1-query-efficiency-20261102`, keeps this investigation separate from PR #10. Both remain unmerged. This delivery update changes documentation only.
- Free compatibility is not certified; retain the limits stated in README. Affected-account expiry/unique operation claims and incremental summaries remain follow-up designs, not implemented runtime changes.
- No Production/Staging deployment or online D1 SQL was performed. Any future rollout needs separate authorization.

## Boundaries / user conversation

No Production/Staging deployment/config/SQL/migration/subscription, no Pages/extension changes, no real AI/payment/email/X operations. Password strength was discussed but not changed; user did not authorize an online change. Preserve all unrelated work and raw profile evidence.
