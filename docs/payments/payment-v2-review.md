# Payment V2: local implementation and review

## Scope and protocol sources

The user-provided Payment V2 brief authorizes local implementation only. No remote operations, real provider API calls, credential access, automatic retries, historical order changes or Git commits/pushes were performed.

Installed skill: `xiaodou-open-platform-integration` (`~/.codex/skills/xiaodou-open-platform-integration/SKILL.md`). No separate marketplace protocol/SDK was discovered. Its RSA2 Open API paths, three canonical signing formats, status semantics, feeProjection, key IDs and source-validation guidance match the downloaded 1.0.0 PUBLISHED docs (03/04/05/07/09/12). References reviewed: api-workflow, signature-spec, error-codes, webhook-verification, terminal-matrix, key-management and go-live-checklist, plus Node sign/response/webhook examples.

No Workers/serverless deployment guarantee or special Cloudflare source-header workaround is documented. Node reference code depends on Node crypto/fs/CommonJS; it is not imported into the Worker. The existing WebCrypto implementation is retained, with independent Node-crypto Mock signatures and the official canonical vectors as checks.

One stricter local policy remains intentional: incomplete response-signature headers fail closed rather than being treated like wholly absent signatures. Unsigned non-2xx errors remain diagnostic observations, not authenticated payment facts.

## Critical defects fixed

1. Webhook canonical text previously hex-encoded raw bytes; the protocol requires SHA256(rawBody). Existing Mock signers repeated the defect. An independently calculated official vector now fails the old implementation; production canonicalization and independent Mock signers use SHA-256. Raw-byte tampering remains rejected.
2. The published Webhook payload does not require a currency member. Old code rejected otherwise valid events without it. Verified events now use the matched order's CNY contract when absent; explicit non-CNY is still rejected before financial changes.
3. Creation/relaunch did not validate echoed order identity, amount and currency before releasing materials. Both use the shared V2 inspector.
4. Delayed create/relaunch writes could replace settled state. Preparation writes now only affect pending/unknown transactions; returned links are suppressed when current status is paid/refunded/closed/failed.
5. Local creation success masked checkout failure as HTTP 201. Unusable checkout now uses explicit outcome and non-success HTTP, retaining durable local order context in the page.

## Architecture and state

- `xiaodou.js`: HTTPS-origin validation, six request headers, WebCrypto request signing, response/raw-event verification, safe errors, manual redirects and a 10-second fetch deadline. No injected fetch receiver, copied incoming headers or retry loop.
- `payment-checkout.ts`: preparation response validation and bounded result vocabulary, failure classification and versioned attempt-marker serialization. It does not grant credits or call D1.
- `payments.ts`: authenticated/CSRF-protected order creation, attempt reservation, persistence and orchestration. Existing settlement/refund transactions remain responsible for financial facts.
- `account.ts`: local-read projection of checkout markers; no provider calls.
- Checkout/account UI: separate checkout preparation from payment status; preserve an already-created local order after a non-2xx response; never treat a return URL as success.

| Checkout outcome | HTTP (create/relaunch) | Meaning/action |
| --- | --- | --- |
| ready | 201 | Verified matching snapshot, valid HTTPS link, acceptable feeProjection; wait for user payment |
| rejected | 502 | Observed standard 4xx rejection, excluding 409; no link or automatic retry |
| unknown | 503 | Network, 5xx, conflict, invalid signature/snapshot, or persistence uncertainty; keep order and reconcile deliberately |
| unavailable | 502 | Signed response but no usable material or fee projection requires review; no link |
| confirmation_required | 202 | Creation reports SUCCEEDED; wait for query/webhook verification, no creation-time grant |

Rejection is a checkout outcome, not proof that an order never existed. Payment status remains conservative; duplicate-order protection remains active. Unsigned rejections carry their actual signatureState only in protected Staging diagnostics.

## Persistence and historical compatibility

No migration, table, column, balance rewrite or new gateway framework is needed. Existing `payment_attempts.provider_code` stores `checkout-v2:<outcome>:<bounded issue>`. The existing state column records prepared/pending/failed/unknown preparation status. Unmarked historical attempts are not reinterpreted: API projection is null. Both known historical UNKNOWN IDs are covered by a no-outbound/no-write local regression.

Queries never renew or return indefinitely cached cashier materials. The current checkout page can retain its already-verified same-order link in memory while both snapshots remain pending; a non-pending result clears it. No browser persistence is introduced.

## Financial guarantees

Server package snapshots remain authoritative (starter 990 principal + 16 handling fee = 1006 CNY fen, 400 credits). Creation and relaunch never grant credits. Existing atomic D1 batches retain event uniqueness, purchase_grant uniqueness, purchase-batch uniqueness, balance assertions and rollback. Signed late payment success can follow failed/closed states; subsequent failure cannot undo paid status. Webhook/query concurrency with checkout disabled is tested against actual SQLite migrations and SQL, including exact 400 paid/200 unchanged free/one grant/one batch results. Refund batch freezing and reversal logic is retained.

## Verification and review

Commands: `npm test`, `npm --prefix api run typecheck`, `npm --prefix api run check:staging`, `npm --prefix api run test:local`, and `wrangler deploy --env staging --dry-run --outdir /private/tmp/xrh-payment-v2-dry-run` (dry-run only).

Independent read-only review identified two UI regressions (pending link lost on refresh, stale checkout text overriding closed/failed). Both were fixed with regressions and re-reviewed. Initial sandbox full-suite failures included local-port EPERM; reruns with local-port permission passed. Existing tests expecting 201 for rejected checkout were updated to the explicit V2 HTTP contract; financial assertions were retained.

## External blocker and next deployment

`BLOCKED_BY_XIAODOU_SOURCE_VALIDATION`: the existing real create rejection remains unresolved. No new evidence establishes which edge reason was involved, nor does a previously verified query 404 prove POST creation compatibility. No forwarding headers, Cloudflare routes, compatibility flags or gateway entry were changed. No proxy architecture was introduced.

Next authorization should deploy Worker and Pages from the same reviewed snapshot, preserving all current Secrets and safe flags (payments off, webhook on, AI mock). No D1 migration or new environment variable is required. Before another real create, obtain gateway-side evidence for the already-recorded create request and resolve existing UNKNOWN handling explicitly. Rewriting the transaction coordinator does not itself fix platform edge trust.

### Final recorded results (2026-10-21)

- `npm test`: 264 passed, 0 failed; includes website build, Mock HTTP/RSA tests, Workers runtime and SQLite SQL integration.
- API `typecheck`: passed.
- `check:staging`: passed with safe defaults unchanged.
- `test:local`: passed, including local migrations, 200 free grant, consecutive generations, 400-credit mock purchase, duplicate prevention and refund reversal.
- Final Staging Wrangler dry-run: passed; no upload/deployment performed.
- `git diff --check`: passed. Branch remains `codex/v0.4-credits`, HEAD `65e243db89456d10e93e63d8dc301e1b7bf4068d`, 14 commits ahead; original uncommitted diagnostics retained. No new commit.

Local status: `READY_FOR_PAYMENT_V2_STAGING_REVIEW` and `BLOCKED_BY_XIAODOU_SOURCE_VALIDATION`.
