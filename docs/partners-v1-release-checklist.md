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
