# Referral rewards V1 — rollout and security

**Status:** source-only development. Do not apply remote D1 migrations, enable the referral switch, deploy Worker/Pages or modify existing user data without independent authorization.

## Product contract

- A qualified real user obtains one stable 16-hex invite code after requesting it from My Account. Share URL: /login/?mode=register&ref=CODE.
- Only newly verified email accounts can be attributed, once, during registration. Resending verification cannot overwrite the original pending referral code.
- After the invitee verifies email, connects a qualified Chrome extension installation, receives their existing signup grant, AND has a confirmed first AI reply delivery ACK, both users receive exactly 50 free generations, with no automatic expiry.
- Referral rewards do not change purchased credits, paid balances, subscriptions, daily caps, payment/order/merchant state, or historical credits.
- Only active, verified, non-test, non-admin inviter and invitee accounts qualify. An invitee is attributed once; rolling 30-day cap is 10 completed referrals per inviter. Matching claimed installation prevents awards. Device evidence is only a defensive signal; it is not proof of unique persons.
- One D1.batch transaction exclusively claims the invite and inserts two free credit batches, two mirrored free balances, two credit_ledger entries, two provenance entries in referral_awards, then checks strict invariants. No partial grant is allowed. Replay ACKs remain idempotent.
- A transient failed award does not invalidate an already completed AI reply; repeat ACK or invitee account refresh can retry.

## Existing constrained ledger compatibility

The existing credit_batches.source_kind and credit_ledger.kind CHECK enums have foreign-key dependents. V1 does not rebuild financial tables. It uses the existing compatible admin_adjustment enum for a referral batch and ledger, but stores unique referral: IDs, reason=referral_reward:inviter|invitee, and independent immutable referral_awards rows linked to the exact batch and ledger reference. These referrals must NOT count as manual administrator adjustments in reporting. A later separately reviewed migration can extend the enums natively.

## API and UI

- GET /v1/referrals/me: authenticated account counters/link/status, available only when feature switch is on; no invitee PII leaked.
- POST /v1/referrals/link: owner-only web session with CSRF, stable randomly generated code. No mutation on GET.
- GET /v1/admin/referrals: Admin V2 authenticated read-only KPIs and exact filtered, bounded pages.
- POST /v1/auth/register: optional referralCode field for new-user attribution only, immutable within a pending verification record.
- User: My Account referral card with link generation and copying, registered/activated/bonus stats.
- Admin: Users -> Referral rewards, real-only metrics, invitee/inviter status, reward audit.

## Rollout gate

1. Only validate source and the SQL migration locally. Migration proposal api/sql-proposals/0026_referral_rewards_v1.sql deliberately reserves 0025 for the separate Xiaodou proposal.
2. After **separate explicit approval**, apply the exact SQL hash to an isolated/Staging D1. The migration inserts system_settings.referrals_enabled=0, so it is OFF by default.
3. Independently authorize Staging Worker/Pages deployment and signed-in/browser, extension ACK, negative fraud, replay and rollback acceptance.
4. Separately authorize Production D1 protected backup/recovery and 0026 application, compatible exact-SHA Worker/Pages release, then explicitly enabling referrals_enabled=1.
5. No D1 operations, real grants, payment/refunds, merchant changes, or Staging/Production deploys are authorized by this development task.

V1 automated testing includes a local SQLite transaction rollback exercise and full normal Push CI. Neither proves Production schema safety or live activation without operator acceptance.
