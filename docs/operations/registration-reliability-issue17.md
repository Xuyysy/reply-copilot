# Registration reliability / issue 17

Production Pages baseline: fe7ac405e69623455405bd9bc07eb883a807c4c5,
Deployment ea26ffac-70b6-4125-b646-d61cf2e918fc. No Production deployment.
Staging Pages baseline: 903a1f1f2a4913650d407a4298ab31122ee72b3b,
Deployment 7df05405-7eae-4804-8602-1cd5eade5f57. Preserve its SiliconFlow UI.

Plan: add a tested bounded per-widget lifecycle; token success only, manual retry,
script failure/deadline and stale callback fencing. Classify frontend API transport
vs HTTP errors; preserve entered data, no automatic register resubmission and
provide a possible-email-sent recovery path. Keep Worker security untouched.
Verify domain/key publicly, CORS and backend existing checks, isolate simulations
from real CAPTCHA/mail/registration. Full regression/types/build, then stage only
these auth files on the existing Staging Pages source. No Worker, D1, credentials,
AI, payment, quota, extension or Production changes.

## Findings / confidence

Confirmed code defects: render() set readiness before any successful challenge;
no error/expired/timeout callbacks, unbounded script polling, global hidden-input
Token lookup and no per-widget stale-callback fence. Error copy referred to a
local service on a cloud site. Client's 15s deadline was shorter than the existing
10s Siteverify + 10s mail timeout budgets plus hashing/D1; this is a timeout risk,
not evidence those stages caused the user's observed failures.

Production public Site Key `0x4AAAAAAFhsvhYsTlFR6LIM` matches the existing managed
Widget allowing only app.x-reply-helper.top. Staging uses its existing separate
managed Widget and key `0x4AAAAAAFYdcIBnXxLTGrT4`. Metadata list only: no Secret
value was read/rotated/exported. Actual current Secret pairing requires a fresh
human challenge submitted to the protected backend; not claimed verified here.

Live OPTIONS /v1/auth/register checks returned 204 for both expected origins,
allow-credentials=true and POST/content-type allowed. This is a point-in-time
check, not proof intermittent CORS/network failures cannot occur. No real POST,
account creation, email or Siteverify challenge was triggered by Codex. No real
client error code or server stage timing from the failed user attempt is
available. Browser/network/VPN/Cloudflare challenge failure remains unconfirmed.

## Implementation

- Existing Astro script remains early/async, now identifiable by the shared
  deduplicating loader. 15s script wait and 120s challenge watchdog; no auto retry.
  Manual retries remove stale/partial owned widgets and use one script at a time.
- Only a valid success callback stores a private, per-widget Token; expired/error/
  timeout/disappeared iframe clear it. 290s local validity is conservative versus
  the service's expiry. Submission consumes it once and fences old callbacks.
  Unmount/tab changes dispose observers, timers and widget. Appearance always
  and a reserved-height container retain recovery UI if the iframe disappears.
- Synchronous submit guard prevents double sends; pending controls disable tab
  switching. Inputs stay intact. Network/timeout/invalid-response/uncertain mail
  outcomes offer explicit code-entry recovery and a 60s resend cooldown; never
  auto resend. Existing server uniqueness/rate/cooldown checks remain untouched.
- API_NETWORK_ERROR (browser cannot distinguish network from access/CORS),
  API_TIMEOUT, HTTP status and Turnstile server rejection remain distinct.
  Register deadline 30s only; other API/model-test timeouts unchanged. An already
  cancelled operation no longer invokes its transport callback.
- Optional visible diagnostics include stage, allowlisted/numeric code and
  elapsed milliseconds only. No email/password/Token/Cookie/URL/request body,
  account ID or Secret is logged/persisted/exported. No Worker change.

## Evidence

- Full suite 762/762, zero failures/skips; API/Web types pass after Astro build.
- Isolated real Chrome + actual React: production baseline fe7ac405 fails the
  pre-verification disabled-submit assertion; candidate passes. Mock response
  processed-but-lost sends exactly once; fields retained, code-entry recovery
  usable, stale callbacks ignored, login/reset tabs work.
- Unit simulations: script timeout/failure/late load/dedup, empty/valid Token,
  error/expired/timeout callbacks, iframe disappearance, partial render/unmount;
  transport timeout/abort/network, invalid JSON, HTTP400/429/503; no auto retries.
- Isolated backend tests preserve missing/rejected Token, hostname/action checks,
  Siteverify replay rejection, one mail send and unchanged account balances.
- Mock tests are not real CAPTCHA acceptance. Final human Staging verification
  must include a real challenge and inbox/code round trip using a controlled
  test email. Do not send passwords or Tokens to the agent.

## Staging acceptance

Use https://staging.x-reply-helper.top/login/?mode=register. Check loading ->
verified -> send. On DevTools network throttling/offline, keep fields, retry
verification manually, ensure no automatic resend. If response was lost, check
inbox and choose the received-code recovery action. Switch tabs and back, wait
for expiry, verify again, and confirm only the latest callback enables submit.
Finish one controlled registration; verify login/password-reset normally.
Export only the verification details' stage/code/elapsedMs if it fails. No need
to share account identity, email, password, challenge Token or browser cookies.

Staging integration must start at 903a1f1f, not overwrite its SiliconFlow UI with
Production source. Only these auth files/tests/docs are ported. Keep the Pages
alias, real Staging Site Key and API origin. Worker/42 bindings remain untouched.

## Separate Production window / rollback

After user Staging acceptance, explicitly authorize Production Pages only.
Recheck current canonical deploy/source, then build from the Production-based
feature branch with PUBLIC_API_BASE_URL=https://api.x-reply-helper.top and the
existing confirmed Production public Site Key. Audit generated JS/HTML; no
Staging origin/test key. No Worker/Secret/D1/plugin deployment is needed.
Before switching capture current Pages deployment. Roll back only Pages to that
captured deployment if hydration, challenge, API or auth regression occurs.
Current recorded Production rollback candidate is
`ea26ffac-70b6-4125-b646-d61cf2e918fc`; recheck before a future release.
A Pages rollback cannot undo emails/accounts created normally during acceptance.
No production account/financial data restoration is part of this workflow.

References: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/
and https://developers.cloudflare.com/turnstile/troubleshooting/client-side-errors/error-codes/.

Detached-widget follow-up: a regression failed before the consume-time node
connection guard and passes after it. This closes the DOM removal / React effect
cleanup gap without changing server verification.
