# 历史准备记录（2026-10-21）

> 当前上线清单见 `../launch/release-acceptance.md`、`../launch/payment-incident-runbook.md` 和 `../launch/chrome-web-store.md`。以下为当时记录；最新迁移已到0012、后台运营开关已启用，不应照旧文直接发布。

# Production readiness — 2026-10-21

## Current evidence

- Staging received a real CNY10.06 Epay payment, exactly one400-credit batch,
  one purchase-grant ledger row and one successful event. Free credits unchanged.
- Cloudflare account inventory contains Reply Copilot Staging Worker, Pages and
  D1 only. No matching Production resources were returned by the account query.
- Local Production config still has placeholder D1 UUID, web/API origins and
  extension ID. `check:production` fails for those four prerequisites.
- Production has not been deployed or modified. Safe Staging defaults remain
  payments0/private-test0, Webhook1, mockAI, admin0.

## Automatic frontend confirmation

The callback writes credits; the browser never does. New Epay return URLs include
only a local `payment_order` locator before provider-added parameters. The account
page strips provider signature/merchant query fields from the address promptly.
The locator is untrusted and only selects the existing authenticated owner GET
`/v1/orders/:id`. It is not proof of payment. Pending browser form submissions also
remember a short-lived order locator, without credentials or balances.

Visible pages poll local state every2.5seconds, for up to120seconds of active
waiting. Hidden/pagehide pauses and releases a short-lived cross-tab lease;
focus/visibility/BFCache recovery resumes. Success requires both server `paid`
and `creditedAt`, then a fresh `/v1/me`, `/v1/usage`, `/v1/activity` refresh on the
account page. A refresh started before payment cannot satisfy this fresh read.
Timeout is unconfirmed, never failed or successful; manual refresh remains.
The browser makes no automatic provider query, payment POST or new order.
Storage/broadcast contains order locators and lease metadata only, never email,
API keys, payment signatures or balances. Closing the browser and later opening
/account/ always fetches current server account data.

## Production resources and credentials to prepare

1. Confirm final web/API HTTPS origins and exact production extension ID.
   Suggested domain layout must be confirmed before configuration; do not infer
   root vs www or create DNS in this task.
2. Create isolated Production D1, record actual UUID, apply migrations0001 through0010
   in ascending order exactly once using the named Production binding. Never copy
   Staging users, auth sessions, orders or testing balances into Production.
   Fresh migration compatibility is already exercised by local fixtures.
3. Create isolated Production Worker/Pages resources, record versions and backup
   any existing Production database before writes. Never use placeholder config.
4. Safely input `XIAODOU_EPAY_GATEWAY`, `XIAODOU_EPAY_PID`, `XIAODOU_EPAY_KEY` as
   Production Secrets. They may belong to the same approved real merchant, but
   bindings must be entered separately; Cloudflare does not inherit Staging
   Secrets. Do not export Staging secret values or place them in frontend config.
5. Prepare independent production AUTH_HASH_SECRET/PASSWORD_PEPPER, mail sender/
   API key and Turnstile widget/Secret. Never rotate an established database's
   existing pepper or hash secret. Approve actual AI mode and cost budget before
   real inference; do not blindly deploy current AI_MODE=production defaults.
6. Select PAYMENT_PROVIDER=xiaodou_epay in the reviewed deployment config.
   Initial public payments0/admin0; callbacks enabled only after keys/endpoint
   checks. Private Staging account settings must not be copied to Production.
7. Final notify URL: `<production API origin>/v1/payments/xiaodou/epay/notify`.
   Final return URL: `<production web origin>/account/?payment_order=<local UUID>`.
   Both derive from trusted origins server-side. Return status is ignored.
   Merchant domain declarations must match confirmed actual production hosts.
8. Keep query strings redacted and automatic invocation logs disabled wherever
   request logging is enabled. Epay GET notifications/returns carry signatures;
   client URL cleanup does not replace infrastructure log controls.

## Reconciliation / missing notification — remaining launch requirement

Frontend polling cannot repair a notification that never reaches the server.
The official local Epay documentation describes bounded notification redelivery.
Check real merchant order number, amount, currency and payment in the merchant
portal. If the portal supports it, request official notification redelivery;
otherwise obtain platform-assisted redelivery. A valid duplicate is safe.
Do not create another order, fake a success notification, or change balances.

Current Epay refresh is explicitly local-only. No authenticated Epay api.php
query/settlement adapter is implemented. The supplied document does not specify
enough of the query-response trust contract to safely implement automatic
financial settlement from guessed JSON. Before general launch, confirm a
reliable redelivery/support process or implement official authenticated query
reconciliation against its complete response contract. Existing admin credit
adjustment is not equivalent to a reconciled purchase order.

Run `api/sql/payment-consistency-audit.sql` read-only against an explicitly named
environment to count paid/grant mismatches, account/batch mismatches, negative or
overreserved lots and missing Epay platform references. It returns summaries only.
It neither repairs data nor proves an unpaid platform order does not exist.

## Refunds — remaining launch requirement

Epay supports merchant-backend manual refunds, not this adapter's RSA2 refund API.
Current app intentionally routes Epay refunds to manual review and does not freeze
or revoke credits from an unverified refund request. The audited D1 refund model
exists, but a trusted manual-Epay-refund confirmation/reconciliation path has not
been completed. Before general launch, finish that operating path and its tests:
ordinary unused-only principal refund; exceptional approved fee refund; confirmed
success before revocation; revoke only the original order's remaining credits;
unknown stays pending; failed refunds restore reservations; never negative.
Do not advertise automated Epay refunds or mark the production refund loop complete.

## Minimum rollout / rollback

- Close reconciliation/refund requirements and confirm domain/extension/merchant
  configuration. Prepare independent resources, verified migrations and Secrets.
- Deploy Worker with purchases off, then compatible Pages; check HTTPS, auth,
  callback invalid-signature rejection and read-only accounting audit.
- Separately authorize the production payment launch and one human-funded small
  purchase. Verify trusted notification, exact-once crediting and auto UI update.
- Close new purchasing immediately on anomalies; retain existing-order reads,
  callbacks and credentials for late payments. Do not drop migrations or erase
  orders. Restore a reviewed compatible code/config version if required.
- No Production writes, paid inference, funds, refunds, commits or pushes were
  performed during this preparation task.

Conclusion: Staging payment works; Production is not ready for general launch
until isolated resources/config and the above reconciliation/refund operations
are ready. This is not a claim that production payments are enabled.
