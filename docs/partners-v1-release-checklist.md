# Partners V1 — release readiness (draft, NO-GO for deployment)

Issue #254 / Draft PR #255. This is a source-review checklist, not an authorization to access any remote D1, deploy, enable flags or move funds.

## Verified evidence

- PR CI [45626648334](https://github.com/Xuyysy/reply-copilot/actions/runs/45626648334), head e897e5c7d52422a2eaa226c89404cf22349a15ce: 90/90 focused tests, API and Web TypeScript, real bundled Worker fetch and scheduled entrypoint against isolated SQLite actual migrations plus proposals.
- 73 SQL plans compiled; local 1,000-commission allocation (751 items) 5.90 ms in that run. This is not D1 latency, CPU, rows read/written, nor an end-to-end performance benchmark.
- Synthetic provider facts and synthetic transfer attestation; no real provider or transfer verification.
- Subsequent lifecycle test adds actual scheduled discovery and post-settlement refund/debt assertions; new head must be validated again.

## Required gates, in order

- [ ] Exact final SHA: green PR CI AND normal full Push CI (full npm test, builds, SHA-pinned artifacts). A lightweight result cannot satisfy release requirements.
- [ ] Independent review of payout and accrual concurrency, security, data handling, missing provider identities and unsupported refunds. No inferred provider IDs; no partial subscription reversal without reliable proof.
- [ ] Owner approval: commission basis, rate/term policy, hold, eligibility/risk criteria, launch window, settlement procedure and commercial/legal/tax/privacy review. CNY 10 minimum is approved; remaining business parameters are not implied by test values.
- [ ] Review source-only proposal order: existing migrations; independently reconcile 0025 and 0027 history; partner policy, ledger, recovery, payout, recipient, transfer, query indexes. Never replay an already applied proposal blindly. All partner flags initially off. No seed activation window or discovery cursor.
- [ ] Separate explicit authorization before any remote D1 read or write, even Staging. Approve exact schema diff, backup/restore procedure and isolated load testing. No commands against remote bindings in this document.
- [ ] Validate query plans and actual D1 CPU/rows read/written, including index maintenance and large partner history. Keep unavailable if over budget; no weakening evidence checks to meet limits.
- [ ] Separate authorization for Staging deployment and pilot configuration; use synthetic accounts and isolated keys only. Check Worker and Pages versions, run browser UX and end-to-end discovery, accrual, refunds, payout and failure recovery.
- [ ] Acceptance of masked recipient reads, audited one-time reveal, reauthentication, exact amount/recipient binding, unknown transfer lock, refund debt, and kill switches. No actual transfer as part of test.
- [ ] Production approval is separate. Current money-posting/review schedulers and endpoints explicitly exclude production; a later audited production enablement change is required, not just configuration.
- [ ] Human acceptance, explicit production deployment and migration permission, verified rollback/monitoring, release evidence and requested documentation update.

## Stop / reconcile

Disable new accrual, discovery and new payout approvals independently when authorized. Preserve immutable financial records. Do not delete payouts or retry unknown transfers. Existing verified outcomes must be reconciled even when new activity is disabled, within the allowed environment. Refund reconciliation is independent of new accrual. Reconcile externally verified payment/refund/transfer evidence before any correction; do not infer success from missing responses.

No remote D1 operations, configuration changes, deployments, merges or real payments performed by this checklist.

## Staging operator-first acceptance (required before owner handoff)

Owner requested that the implementer create and exercise dedicated QA accounts and complete acceptance before asking the owner to test. Do not ask the owner to be the first tester. Record exact release SHA, Worker/Pages version, test time, case results, account aliases (never passwords), defects and retest evidence.

Account matrix (aliases only; not created yet):
| Alias | Expected behavior |
| --- | --- |
| QA partner A | Active partner, authorization history, masked payout destination, eligible order commission, hold, request and reserve |
| QA buyer B | Attributed new invitee, settled synthetic credit order, partial/full refund and retry |
| QA buyer C | Attributed subscription purchase/renewal/upgrade, supported full refund and unsupported/ambiguous evidence |
| QA outsider D | No partner authorization; cannot read A's records or use admin endpoints |
| QA excluded E | Explicit test-account marker; never cash eligible |
| QA partner F | Paused partner, prior earnings, insufficient funds, debt and stale recipient version |

Use the existing singleton authorized staging admin; do not create a second admin or relax reauthentication. Do not unset a real test-account marker to bypass the cash eligibility guard. For eligible synthetic cash-flow QA, provision an **isolated staging-only database and isolated Worker/Pages binding**, with exclusively synthetic normal-role users; block all actual provider, email and transfer calls, use non-real recipient information and distinguish every synthetic financial record. This is a proposed approach requiring explicit approval before any remote D1 action, including provisioning, inspection, seed, or migration. Shared Staging may only use clearly marked test accounts for non-financial negative/UI checks unless an independently reviewed isolation plan is approved. Do not seed fabricated provider success into a shared or real payment database.

Before handoff:
1. Verify final SHA, full Push CI and artifacts, approved configuration, environment isolation and no live payment secrets or outbound transfer capability.
2. Create QA accounts under approved isolation; record aliases and expected starting balances. Test sign-in, referrals, partner authorization, CSRF and reauth, account ownership, recipient masking and version changes.
3. Exercise discovery, approval, scheduler, holds, pending/duplicate requests, refund reconciliation (including post-payout debt), manual simulated outcome and unknown transfer lock. Verify DB invariants with the approved test scope; test off switches and recovery.
4. Test browser flows for both the user and administrator at desktop/mobile widths; verify errors, loading, refresh, disabled states and no plaintext outside the authorized reveal. Do not claim browser testing without actual browser evidence.
5. Repeat failed cases after fixes, record pass/fail and unresolved issues. If any release-blocking case fails, no owner handoff. Freeze/retain synthetic financial history under the approved retention plan; do not delete financial rows.
6. Only after all required tests pass, provide owner a concise report, exact Staging URL and approved QA account access through a secure channel, plus a short owner acceptance path. Never place passwords or keys in GitHub or public logs. Owner's acceptance remains separate from production authorization.

Current execution: only isolated local/CI tests, no Staging QA account creation yet. Do not represent these aliases as existing logins.

## Consolidated local acceptance evidence

- Main candidate 31e7ba64: [full PR CI 45628755997](https://github.com/Xuyysy/reply-copilot/actions/runs/45628755997), 1575/1575 tests and 91/91 focused regression checks; merge-context evidence, not exact-head release artifacts.
- Child draft #258 b12c29fe: [isolated Chrome browser QA 45630138724](https://github.com/Xuyysy/reply-copilot/actions/runs/45630138724) passed actual Astro user/admin pages and real bundled Worker, synthetic authorization, discovery, approval, receiving details, request, reserve, one-time reveal, simulated outcome and ownership. Companion CI 45630138568 passed 91/91.
- The passing browser files are copied into the main candidate; repeat full and browser checks together on the integrated head. No remote staging accounts or funds yet. Browser QA uses local synthetic sessions (not proof of real hosted login or provider settlement).
- Exact-head push metadata is reported by the candidate PR's read-only CI lookup; inspect the push job and SHA-named artifacts before release. No deployment is authorized by CI.
