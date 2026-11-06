# Issue 18 second acceptance candidate: review the original order on the website

## Baseline and scope
Pages source `bd253d8dbcb27619c93d0ee42c4378b0b948172a`, deployment `46b8d400-7293-4fdb-a38a-f92b9fce2578`. The existing Worker remains source `da779958b1fb5809aaeb8d0ffed1da520901f6ba`, version `e6c967d3-1f47-46f3-98bc-9e56c9ca4c9f`, deployment `4822556d-052f-4217-88bf-9808dcf92a57`. No Worker deployment, database SQL/migration, Secret, merchant setting, payment switch or model change is needed. This branch is based on the actually deployed Staging Pages, preserving Issue 17 and all Staging-only features.

## New flow
Account Continue payment performs one owner-protected local order GET and opens `/checkout/?order=<original ID>`. It never creates an order or opens a third-party cashier from the account page. Invalid order IDs and mismatched/inaccessible orders cannot navigate.

The existing checkout displays the original package, credits, immutable CNY snapshot, order ID and friendly status. A pending, clear, unsettled MK99 order is queried through the existing authenticated refresh operation, followed by a fresh owner-protected GET. Cashier access requires the verified pending result and the original HTTPS URL matching the server-validated origin. It is rechecked on the user's explicit cashier click. GET polling never creates a transaction. Unknown, paid, closed, failed, refunded and review states cannot pay the original transaction. Late pending reads cannot revive a confirmed terminal state.

Only a clear terminal MK99 order with an existing, currently offered CNY-priced package and currently available payment methods exposes `/checkout/?package=<actual package ID>`. This only opens the existing selection screen; the user must select a method, review the current price and explicitly create a new order. The new package route takes precedence over a remembered old order; ordinary checkout reopening without a package/order locator still resumes remembered payments. Backend UNRESOLVED_ORDER_EXISTS remains authoritative and has no MK99 restart/bypass action. Existing Epay explicit original-form restore and permitted restart behavior remain separate.

## Independent unresolved merchant blocker
The user observed `当前支付域名未报备或未通过审核` at `mk99.cn/process/next`. This is not proven to be a project-code defect. Changing the account entry to the website does not resolve or bypass provider approval. The merchant must confirm the approved cashier/payment domain and platform restrictions with MK99. This task does not proxy the cashier, forge origins, change return/notify domains, close/delete pending orders or call create/relaunch. Generic user help explains retry/support and avoiding duplicate orders; the website cannot inspect a cross-origin cashier error screen. No claim that the merchant-domain issue is fixed.

## Verification and manual acceptance
All automated upstream/payment interfaces are mocks; local database regressions use newly constructed synthetic fixtures, not Production/Staging databases or restored copies. No real account, order, payment or provider API call is created by tests.

1. In Staging account, click Continue payment on an existing pending MK99 order. Expect the website checkout with the same order ID/package/amount, not an immediate third-party navigation.
2. Pending: the page checks existing payment status. If still safely payable, explicitly opening the original cashier checks it again. A provider domain-approval failure remains a merchant-side blocker; do not duplicate the order.
3. Unknown/review/query failure: no cashier or replacement purchase. Refresh/check support, without repeatedly paying or creating orders.
4. Paid: settlement status shown and no second payment. Closed/failed/refunded: no original cashier; only eligible terminal orders with available packages show Choose a payment method again. Do not make real test orders merely to verify the link.
5. On the new package screen, payment choices are shown. User action is required to create a new order; any other unresolved order still causes the server to block creation.
6. Check Chinese/English, 375px layout, old Epay, existing notice dismissal, new payment events and account isolation.

## Rollback and Production
Roll back Staging Pages to `46b8d400-7293-4fdb-a38a-f92b9fce2578` through Cloudflare Pages deployment history or its authenticated rollback API. Leave the current Worker and all database records intact. This rollback restores the former direct-cashier account entry, so it does not remove the merchant approval blocker.
Production is unchanged and requires separate approval after Staging manual acceptance and resolution/assessment of the merchant-domain blocker. No automatic merge or store release.
