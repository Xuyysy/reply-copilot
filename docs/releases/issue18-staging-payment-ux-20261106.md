# Issue 18: Staging payment UX acceptance candidate

## Scope and sources
- Production Pages feature baseline: `540b8944c310cdecbc2b7358a63c04b5e937834c` (includes accepted Issue 17).
- Staging Pages integration baseline: `79e79845b470c0d0915875f18979b87b9a6c5d5c` (preserve SiliconFlow and existing Staging UI).
- Staging Worker integration baseline: `404ff20334e5d0a9436e9da94c41407d7fa4d4ac` (preserve PR 16 recovery/performance and 42 live bindings).
- Never deploy a Worker built from a Pages-only integration baseline. Production is not deployed in this task.

## Behavior
MK99 continue payment reads the owner-protected original order, validates pending/clear/unsettled cashier material, queries the existing transaction once, then re-reads and validates the original unchanged URL before saving return tracking and navigating in the same tab. No create/relaunch API is used. The server revalidates stored HTTPS links against its configured cashier origins and withholds links for credited/risky/terminal orders; the authenticated response supplies only that validated public origin, never a secret. Existing Epay checkout entry is preserved.

The list now includes existing risk/settlement flags from its original SQL query. No migration, historical record modification, accounting change, new query endpoint, provider signature change or payment setting change is involved. Cashier-link lifetime is not invented: a provider-expired original link is not renewed, and users are directed to refresh/contact support.

Notices use account + order + event identity. Dismissal unmounts the complete alert and never stops payment polling. Effect/language replays cannot resurrect dismissed events; a different result can still appear. Account switches reject old callbacks. Progress cannot overwrite a terminal notice. Monitoring now prioritizes transaction payment_status over recharge workflow status; refresh retains the observed order until its terminal callback, preventing loss of a paid notice during account refresh.

## Automated gates
Full npm test; API/Web types; Staging Pages build; Worker dry-run. Isolated tests cover trusted URL restoration and provider query, all terminal/risk states, other-user 404, malformed/malicious URLs, existing purchase-grant evidence, click coalescing, no order creation, Epay, event suppression and account isolation. Headless actual React tests cover Chinese/English, keyboard dismissal, new events and 375/1280px layouts. All upstream and payment data in tests are synthetic.

## Manual Staging acceptance (no payment required)
1. Reload /account and inspect an existing closed order: no Continue payment; Closed badge and support remain.
2. On an existing valid MK99 pending order, inspect Continue payment next to Refresh payment status. Clicking runs an authenticated query and opens the original cashier only if still payable. Do not pay merely for testing.
3. Close a payment notice with mouse or keyboard. Refresh account data and switch language: the same event remains dismissed. Actual monitoring continues.
4. A later different payment result may show a new notice. Switch accounts and verify no prior account message is shown.
5. At a narrow width actions wrap without horizontal page overflow. Existing Epay continuation remains unchanged.
Authenticated cashier expiration and actual account scenarios remain user acceptance, not claimed by public-page checks.

## Rollback and future Production
Staging Worker rollback: `4e8f58d3-8d15-4bf1-a55a-ba1ae9fd0747`; Pages rollback: `db63ae14-9f9d-485f-858e-dba4af12e658`. Roll back Pages first, then Worker if required. No database restore or data rollback. Preserve the current live settings, secrets, D1, cron and routes.
Future Production requires separate authorization and fresh source/settings checks. Apply the tiny API read-side patch to the actual Production Worker source (not this Pages baseline); deploy Worker before its matching Pages. Current old clients remain compatible with additive fields. If reverting only the Worker while retaining the new UI, continuation fails closed until UI rollback; no new order can be created.

## Published Staging record (2026-11-06)
- Feature source (Production Pages baseline, not deployed to Production): `584e3c50ee5959546fd9e0b0a4ef31ab05704e84`, branch `codex/issue18-payment-ux-20261106`; full suite 770/770.
- Staging Pages source: `bd253d8dbcb27619c93d0ee42c4378b0b948172a`, branch `codex/issue18-staging-pages-20261106`; full suite 784/784; API/Web types and explicit Staging build pass.
- Staging Pages deployment: `46b8d400-7293-4fdb-a38a-f92b9fce2578`.
- Staging Worker source: `da779958b1fb5809aaeb8d0ffed1da520901f6ba`, branch `codex/issue18-staging-worker-20261106`; full suite 803/803, API types and dry-run pass.
- Staging Worker version: `e6c967d3-1f47-46f3-98bc-9e56c9ca4c9f`; deployment `4822556d-052f-4217-88bf-9808dcf92a57`, 100%.
- Candidate versus prior version: all 42 binding definitions equal; live post-deployment bindings, compatibility settings, usage model, placement, observability, tail consumers, logpush, cron and routes equal.
- Staging health/packages HTTP 200; payments available with existing Alipay/WeChat channels; unauthenticated /me and order detail remain HTTP 401. No real payment, model generation, new order, account balance modification or remote D1 SQL was performed.
- Production unchanged: Pages `4c13744f-070e-4c59-aa5d-27b20650f74f`; Worker `ed4402fa-a80a-42d8-adec-8066cd914b95`, deployment `b4f9b9fb-a2b7-41ff-a641-2471d925f5bf`.
- Authenticated Staging acceptance is pending the user's manual checks; public checks and synthetic browser tests do not imply a real cashier payment or expiration-lifetime verification.

Executable rollback commands (only if rollback is needed):
Wrangler 4.151 does not provide a Pages rollback subcommand. Use the authenticated Cloudflare connector/API (or the project's deployment history → Rollback):
```js
await cloudflare.request({method: "POST", path: "/accounts/cb5fc919a9f05dcf39b3ca29c9538a1f/pages/projects/x-reply-helper-staging/deployments/db63ae14-9f9d-485f-858e-dba4af12e658/rollback"});
```
Then, only if the Worker must also be reverted:
```sh
wrangler versions deploy 4e8f58d3-8d15-4bf1-a55a-ba1ae9fd0747@100 --config /private/tmp/issue18-staging-live.json --yes
```
Recheck live settings/version before running; no database restore. The local temporary config targets Staging only and contains no Secret values. If unavailable, use Cloudflare's existing project deployment history for the same IDs.
