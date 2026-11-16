# Production BoltUtil USDT: merchant acceptance workbench

## Version and scope
This feature is added on top of the separate 2026-11-16 Production BoltUtil D1 0031 migration and the read-only API-key ping. The UI shows a live **Worker/operator declaration snapshot** and supports a **manual, admin-only, Production API-key ping**, with a sanitized copyable operator handoff. It does **not** arm, sell, take payment, inspect merchant wallets, or prove a signed webhook.

Source is limited to \`AdminBoltMerchantAcceptancePanel.tsx\` imported into the existing BoltUtil panel; no changes to MK99/Xiaodou, Admin V2 navigation, schema, Worker Secrets, Production Pages or Workers configuration.

## How to use after a separately approved Production release
1. Open \`https://app.x-reply-helper.top/admin/\` as the actual site administrator and navigate to the USDT payments panel.
2. View the dedicated Production merchant acceptance workbench.
3. Manually click **Run read-only API Key check** once. The backend requires the current admin session and, only in Production, uses the existing \`BOLTUTIL_API_KEY\` to make a GET request to \`https://api.boltutil.com/api/v1/ping\`.
4. An HTTP 200 is **Key connectivity only**. A 401/403 is unauthorized, 429 is rate limit, other HTTP statuses and network errors remain unverified. Do not infer wallet, callback or token permissions.
5. Review the ten independent Worker/operator readiness declarations and the five-network list. Token contracts/mints are static public identities **not receiving addresses**. A gate marked "declared" is **not** a verified migration, provider or finance approval.
6. Copy the sanitized acceptance handoff for the operator. It contains statuses only; no API Key, Webhook Secret, merchant wallet, checkout URL, customer information or raw provider body.
7. Independently validate live merchant wallet setup per network, signed Webhook connectivity/retries, correct Product token and decimals, an owner-approved actual CNY/USDT FX rate, and the single-chain paid settlement + idempotent entitlement under a separate action-specific approval.

## Explicit safety and stop conditions
- The workbench cannot modify \`system_settings\`, Worker runtime bindings, Secrets or D1.
- No automatic ping on dashboard load; it is triggered manually. Results are temporary memory state only, not a durable merchant authorization or audit attestation.
- No test funds are transferred and no invoice is created. A real payment test **must not** be included in CI or an admin diagnostic.
- Keep \`BOLTUTIL_ENABLED\`, \`BOLTUTIL_PRODUCTION_CREATE_ENABLED\`, per-network ceilings and the Production operator master OFF until separately approved. Existing MK99/Xiaodou remain untouched.
- \`/v1/admin/boltutil/provider-ping\` returns only a bounded status; never display or log full secrets, wallet or merchant identifiers.
- Deploy this feature only after exact-SHA release branch full Push CI and Production build, and separately approved Worker + Pages releases. A Push or PR merge alone is never a deploy.

## Evidence classification
| Evidence | Source | What it establishes |
|---|---|---|
| \`api/v1/ping\` status | On-demand upstream check | Key connectivity only |
| Admin runtime checks | Worker variables and system_settings flags | Declared runtime gates, not independently verified facts |
| Five-network contract/mint | Version-controlled \`contract.ts\` | Static USDT token identity; not a receiving wallet |
| Merchant wallet / callback / FX / real settlement | Separate owner/operator evidence | **NOT VERIFIED** by this workbench |
| CI 1333+ regression tests | Isolated fixtures | Code behavior, not real on-chain transfer |

Provider docs:
- https://boltutil.com/developer-docs?s=auth
- https://boltutil.com/developer-docs?s=signature
- https://boltutil.com/developer-docs?s=networks
