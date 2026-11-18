# CNY / USDT subscription upgrade compatibility — 2026-11-18

## User-facing failure prevented

A BASIC subscription purchased with settled BoltUtil USDT has no
`subscription_payment_transactions` CNY row. The preexisting CNY upgrade
cashier unconditionally joined that fiat row when creating a PRO upgrade and
again during signed MK99 settlement. Therefore a legitimate USDT subscriber
could not change payment rail to Alipay, and relaxing only the creation query
would risk taking CNY money without applying the upgrade.

## Bounded change

- Shared, SQL-only `verifiedSubscriptionSourceSql(env)` requires the existing
  source subscription order to be paid and applied, with either:
  - a CNY transaction that is paid, clear, amount-matched and backed by a
    `PAYMENT_SUCCEEDED` merchant event (real merchants only in Production); or
  - a BoltUtil subscription order that is paid and applied, amount-sufficient,
    network/hash-matched and backed by a nonempty receipt SHA256.
- BoltUtil proof only appears in SQL when `BOLTUTIL_SCHEMA_READY=1` in a
  Staging/Production environment. The fiat path remains available without the
  crypto schema and without inventing fake fiat merchant transactions.
- Apply the identical source proof at CNY upgrade order creation, CNY upgrade
  settlement, and USDT upgrade settlement. The **new** payment itself retains
  its original merchant-authenticated verification. The period must still
  be active with matching owner, quote, plan version, price and expiry.
- If the old payment proof disappears after a new paid invoice is issued,
  preserve the authenticated new payment for manual review; do not amend the
  original period or fabricate a refund or duplicate quota.
- No change to existing customer subscription-account verification, atomic
  generation reservation, ACK/release, fiat-only purchase/renewal, USDT
  purchase/renewal, refund behavior or price quote calculation.

## Mock regression matrix

1. BEP20 USDT BASIC -> MK99 Alipay PRO on Staging and Production:
   valid signed original USDT receipt, verified new fiat payment, one tier
   change, unchanged end date, four consumed daily slots retained, zero
   synthetic fiat transactions or permanent-credit mutation.
2. Replayed MK99 query: exactly one upgrade.
3. After cashier creation, remove old signed USDT receipt: newly verified
   fiat payment remains recorded, but upgrade is held for review.
4. After cashier creation, disable BoltUtil D1 schema flag: cannot grant
   from absent crypto proof, and does not query the crypto tables.
5. MK99 BASIC -> signed TRON USDT PRO on Production: one amendment,
   independent payment evidence, unchanged expiry and used count.
6. After USDT invoice creation, remove original MK99 signed payment event:
   verified new USDT transfer remains audited, but no upgrade entitlement.

This is a source-only candidate and local in-memory SQLite/mock-provider test.
No D1 SQL (including read-only), merchant checkout, money transfer, Live
user changes, Staging/Production deployment or Web Store publication.
Production release requires separate owner authorization and exact-SHA
full Push CI + Production Build. Do not conflate admin-only fiat hold/refund
operations with USDT; those need their own explicitly approved design.
