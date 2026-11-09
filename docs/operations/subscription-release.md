# Subscription V1 release notes

Issue #21 and draft PR #22 are a development candidate. The three subscription switches default to off. Checkout still requires the active merchant and channel to be released. No cloud migration or rollout is part of this change.

## Payment and usage semantics

- ¥69.90 / ¥119.90 / ¥179.90 / ¥259.90 buy 500 / 1,000 / 1,500 / 2,000 daily generations for 30 anchored 24-hour windows. There is no automatic renewal or quota rollover.
- A five-minute server-owned upgrade quote locks the plan versions, owner, amount and original period end. The exact final-24-hour boundary is enforced on order creation. Settlement of an issued order may occur after its quote expires. If the original period can no longer be amended, verified money is retained as a review case and no replacement entitlement is created.
- The authenticated provider query and signed callback use the same subscription settlement logic. Purchase, renewal and upgrade histories remain separate from permanent credit transactions. Replays cannot reset the day or charge twice.
- Verified full refunds revoke the affected period. Partial refunds, missing refund amounts, freezes and manual chargeback reviews pause it. An applied upgrade may have later amendments and usage above its original tier, so review pauses the affected period rather than rewriting counters or reverting the tier. A reserved generation authorized before the hold still resolves through its original ACK or release path. Historical consumption is retained.
- An administrator can hold a paid order and recheck it through the pinned merchant query. This candidate has no merchant refund initiation or administrator entitlement override. An unresolved or partially refunded order stays under review until the merchant provides final evidence. The finance display separates gross verified payments, full refunds and held orders. It does not calculate net cash after partial or pending refunds.

## Migration and rollback

1. Before any separately authorized rollout, identify the actual target Worker and schema version through authorized release records. If it differs from the expected 0021 baseline, stop and reconcile the migration chain. Compare and rehearse on a disposable synthetic fixture.
2. With all three switches off, apply 0022 (isolated plans, orders, periods, tier amendments and quota buckets), 0023 (one-shot cashier persistence) and 0024 (upgrade quote snapshots and bounded date indexes) in that order. Preserve migration history, payment settings and existing credit data. Never restore an older database over real transactions.
3. Release a Worker containing all subscription callback, query, ACK and reconciliation handlers, then matching Pages. Verify old clients and existing payment channels first. With separate authorization, enable the catalog, then the reconciliation switch, then new checkout. Smoke test each stage before any new sale.
4. For rollback before any subscription transaction, roll Pages back first and restore the recorded previous Worker. Leave additive schema intact. After sales or quota reservations exist, disable only new checkout immediately. Keep a compatible Worker, subscription processing, signed callbacks and pending ACK/release alive until all paid and uncertain transactions, renewals and in-flight allocations are reconciled. A pre-subscription Worker rollback would drop those handlers.
5. Separately approve real merchant sandbox or supervised payment verification, cross-device browser checks and any Chrome rollout. Verify current and pending store versions before assigning the final manifest version. Do not reuse an old Chrome ZIP to publish this candidate.

## Compatibility

The 0.3.5 source branch removes the hardcoded Momentum disclaimer. This candidate carries that change and builds as 0.3.6. A subscription-funded generate/ACK omits the optional permanent-quota snapshot so 0.3.5 does not cache a zero permanent balance as exhausted after a successful subscription generation. Account usage still returns unchanged permanent free, paid and total fields plus the separate subscription bucket. The updated client uses its authenticated ACK snapshot without a new request or a longer authentication TTL.
