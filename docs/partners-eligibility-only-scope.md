# Partner eligibility-only development candidate — not approved for release

Owner feedback: no public promotion guide or copy toolkit, for any user. Retain the existing ordinary referral UI and credit behavior. Only the singleton administrator may authorize eligible ordinary users; the account panel is rendered only after the authenticated server returns an assigned policy. Paused partners retain their policy display.

This branch is a genuinely narrower functional milestone from the deployed Paid performance baseline. Reuses the original V1-A policy schema, validation, administrator authentication/reauthentication, immutable version history and existing UI. Rate and term are configured policy terms only, not an activated promise of earnings. The proposal stays outside automatic migrations, defaults OFF and is not executed remotely. There is no new accrual, discovery, refund, payment, recipient, withdrawal or settlement code in this branch. No fabricated zero balances.

The existing PR #268 and its approval conditions remain unchanged. This is source development only, not an alternative protected release path; the same established version, CI, D1 authorization, backup/restore and authorized Worker release mechanisms must be satisfied before any deployment. No protected workflow modification or dispatch, credential changes, or remote D1 operations are authorized by this branch. Do not substitute this milestone for full financial acceptance.

Tests: existing V1-A SQLite policy tests, route guard and scope regressions, normal full Push CI. Actual deployed version and authenticated browser acceptance remain outstanding.
