# CF Free — verified subscription finance summary without mandatory 30-day history scan

Date: 2026-11-17 (UTC). Candidate release for `reply-copilot` Production.

## Why now

Cloudflare read-only GraphQL D1 Query Analytics (no remote D1 SQL) identified another cost after the admin directory and AI model-cost batches were addressed. For the sampled window **2026-11-17 06:15 UTC onward**, the old 30-day subscription usage query reported **473,340 rows read across 21 sampled invocations**, about **22,540 rows per invocation**. Query groups are adaptive samples and must not be summed as a substitute for D1 daily read totals.

The existing `SubscriptionAdminPanel` automatically called `GET /v1/admin/subscriptions/finance` whenever its filters/refresh changed. This endpoint runs both verified-payment aggregation and 30-day `subscription_usage_events` + `ai_usage_costs` join/aggregate, even if the administrator only wants to review subscription orders or verify payments.

## Complete feature: summary now, exact history on demand

- `GET /v1/admin/subscriptions/finance?view=summary` runs exactly the existing **verified-payment** aggregate, skips the 30-day usage/cost history SQL entirely, and returns `usage:null`, `detailScope:'summary'` instead of a misleading zero.
- Legacy `GET /v1/admin/subscriptions/finance` remains fully backward-compatible, including exact 30-day consumed generations and AI upstream cost joined to subscription allocations. Adds `detailScope:'full'` only.
- `SubscriptionAdminPanel` loads the verified-payment summary by default and displays a bilingual explicit button to request the exact 30-day usage and cost. Loading/error/retry states are localized. The provider-paid proof, order risk audit, subscriber plan editing and existing payment controls stay unchanged.
- A request revision token prevents stale history responses from altering the UI after navigation, filter changes or refresh.
- `SUBSCRIPTION_30D_USAGE_SQL` now lives in a single shared module used by both the original authorized endpoint and the isolated synthetic workerd D1 benchmark. The query's financial arithmetic and joins have not changed.

## Isolation, tests and rollout

- No D1 schema migration, SQL run against Production, Staging or replicas; no payment settlements, credits, refund, auth or Secrets changed. All benchmark SQL runs on **isolated synthetic** workerd D1 with outbound fetch disabled.
- `api/tests/subscription-admin.test.mjs` checks no history query on summary, non-admin denial, no credit mutations and exact legacy full report, including exclusion of unrelated cost rows.
- `api/tests/subscription-finance-free-performance.test.mjs` compares the full query cost vs no historical query with 8,000 synthetic usage and cost entries.
- `web/tests/subscription-finance-free-ui.test.mjs` protects the admin on-demand state and unchanged payment tools.
- PR CI + Push full CI + postmerge Production CI and immutable Production Build must succeed on one exact SHA. Production deploy remains manual through protected **Worker first, Pages second** workflows with compare-and-swap version IDs.
- After deploy, recheck all Worker bindings, Secrets, DB, CNY/USDT exchange rate, five USDT networks and payment flags, with password Free flag still OFF.
- Real Free readiness requires **complete postdeploy UTC days** of D1 reads below 5M (prefer 3M), D1 writes below 100k, account-wide Worker requests below 100k, and no essential invocation exceeding the **10ms CPU limit**. The previous real CPU sample around 06:15 UTC showed P95 ~9.3ms, P99 ~15ms, so **no-go for Free** until fixed.
- Revert via protected Worker and Pages deploys only. Summary is backwards-compatible with old full API because the UI simply omits fetched data until explicitly requested; switching to an old Worker causes full behavior on summary requests, potentially restoring read costs but not corrupting payment data.

Supporting prior releases: PR #163 (directory read hotspot) and PR #164 (on-demand AI model-cost reporting). Cloudflare: https://developers.cloudflare.com/d1/platform/pricing/ and https://developers.cloudflare.com/workers/platform/limits/.
