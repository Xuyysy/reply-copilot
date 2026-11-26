# Independent QA API token — isolated resource preflight

## What this module completes

A fail-closed, read-only release preflight for the exact independent QA Worker and D1. The existing application candidate is ff8a2e2c7e85f2faf56232739d280415f964ef9d. Preflight does not issue credentials, initialize passwords, alter settings, deploy, or perform business acceptance.

Verified actual resources again via the existing connected Cloudflare API: exactly one dedicated D1 binding, expected QA origins, mock AI, payments/webhooks/subscription checkout/BoltUtil/scheduled task ceilings off, four expected secret bindings, workers.dev enabled/preview URLs disabled. Dedicated database has 33 migrations, 7 synthetic profiles, 0 initialized passwords, 0 active sessions, 0 commissions, 0 enabled partner flags, foreign keys clean. Existing shared Staging and production not accessed.

## Optional protected GitHub preflight

No local code execution is required. An additional token is not necessary for the connected API's current read-only inspection. Create one only if you want repeatable protected GitHub preflight:

1. Cloudflare dashboard > My Profile > API Tokens > Create Token > Custom token.
2. Select Workers Scripts Read (or narrower individual Worker metadata read if available) and D1 Read. Scope to the account containing reply-copilot-api-partners-qa, and the specific Worker if the dashboard permits. Set a short expiration. No account-wide edit, DNS, Pages, billing, production access or Global API Key. Cloudflare D1 permissions may apply to all D1s in the selected account; exact UUID is a software guard, not an independent permission boundary.
3. Store the token only as Environment secret PARTNERS_QA_CF_READ_TOKEN in partners-qa, restricted to chatgpt/partners-staging-qa-20261125, with required review if supported. Do not use repository-wide secrets, share token in chat, or grant additional rights if a read-only API returns forbidden.
4. After review and explicit approval, the designated push marker runs the protected read-only preflight. Ordinary PR CI runs offline mocks only.

Current workflow restricts API host, method, exact account/Worker/database paths, and four static read-only D1 queries. No redirects; no raw response or token output. Offline tests exercise wrong resource, unexpected bindings, provider secrets, preview exposure, partial credential initialization, active sessions, financial state, excluded marker, singleton administrator, FK errors and arbitrary SQL rejection.

## Credential provisioning boundary

A token does not itself initialize test logins. The earlier automated installation of a temporary credential grant was blocked by execution safety checks. This module does not move that operation into another execution channel. The proposed login workflow remains separate and unexecuted until credentials are provisioned through the independently reviewed and approved secure configuration procedure. No need to generate local passwords for this preflight. Do not request D1 Write or Workers Scripts Write merely to get this check green.

No claim of hosted login/financial/browser acceptance, no handoff. Real hosted login, internal financial lifecycle and actual browser acceptance remain mandatory.
