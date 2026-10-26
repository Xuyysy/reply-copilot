# Payment V2 implementation plan

Goal: implement the user-approved attached Payment V2 brief locally. No deployments, real provider calls, remote data writes, credentials, Git commits or pushes.

Architecture: retain the WebCrypto/RSA client and atomic entitlement/refund ledger. Introduce one small checkout coordinator/validator, keeping checkout outcomes separate from payment status. Reuse payment_attempts for versioned checkout markers; unmarked historical attempts remain unchanged. No migration required.

1. Protocol review: cross-check installed xiaodou-open-platform-integration references/examples against downloaded API docs. Record conflicts and source-validation limitations.
2. Client: test then enforce clean HTTPS origin, manual redirects, bounded request timeout, default Workers fetch invocation, verified responses and safe errors. No Node SDK dependency.
3. Checkout: test then validate signed identity/amount/currency/status/materials before release; classify rejection, uncertain result and unavailable materials. Persist outcome using versioned markers, retain duplicate-order guard and protect terminal states from delayed create/relaunch writes.
4. API/UI: return explicit checkout outcome and non-success HTTP for unusable checkout, preserving local order ID and safe Staging diagnostics. Recover order context in the checkout page, show bilingual distinct outcomes in checkout/account views. GET/activity read locally only.
5. Verification: Mock HTTP/RSA and actual local SQLite/D1 adapter tests, parallel duplicates and webhook/query idempotency, historical UNKNOWN preservation, Workers runtime, full suite, typecheck, website build, staging check and Wrangler dry-run.
6. Review: inspect changes against baseline, preserve existing working-tree changes, document unresolved external SOURCE_IP_REJECTED and deployment prerequisites. No automatic operations on historical orders.

Review focus: unsigned errors never become authenticated facts; signed mismatches cannot release links; late create responses cannot regress paid/refunded state; query responses never recreate cashier materials; malformed/ambiguous outcomes never grant credits.

## Execution result

All six steps completed locally. Official protocol cross-check uncovered and fixed the raw-byte hex/SHA-256 Webhook defect and the undocumented mandatory-currency assumption. Independent review completed; its two UI findings were fixed and re-reviewed. Final suite: 264 passed, zero failed; typecheck, website build, staging check, local D1 Mock E2E and dry-run passed. No remote writes or Git operations performed. Detailed results: `docs/payments/payment-v2-review.md`.
