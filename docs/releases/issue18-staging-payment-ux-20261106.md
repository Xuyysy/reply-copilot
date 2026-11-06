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
