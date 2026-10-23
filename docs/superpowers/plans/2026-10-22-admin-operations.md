# Admin operations implementation

Approved scope: one stable user-ID administrator, audited atomic credit operations, live packages/content, practical existing admin UI. Staging only; no payment/refund, Git publish or Production write.

1. Add additive 0011 schema: singleton binding, operation deduplication, short reauthentication proofs, test archive flags, package settlement settings and immutable transaction snapshots.
2. Harden server admin access with singleton binding plus existing verified active web session and CSRF. Sensitive writes require 15-minute password proof, atomic operation ID and audit.
3. Extend users, metrics, package/content management. Archive is reversible and excludes accounts with payment history. Credit balances reconcile with lots; no negative available balance.
4. Reuse existing dashboard; public content is plain text, URLs allowlisted. USD display and final CNY checkout preserve existing Epay.
5. Mock regression/full tests, type checks, builds and review. Backup and validate Staging before 0011; bind paid account owner. Deploy coordinated Worker/Pages with payment off and AI mock.
6. Verify configurations, singleton admin and unchanged financial records; report actual evidence and remaining Production work.

Rulings: fixed-CNY settlement remains default to preserve successful payments; optional manual FX is explicit. No destructive account deletion; archive preserves audit and financial history. User authorizes admin binding to owner of paid order 09042342-32b2-475d-9659-23f6914cc584. Existing dirty workspace is retained; no commits.
