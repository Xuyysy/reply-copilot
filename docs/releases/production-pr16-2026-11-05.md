# Production PR16 recovery / normal-path release

Baseline: deployed Production source fe7ac405e69623455405bd9bc07eb883a807c4c5.
Feature reference: 404ff20334e5d0a9436e9da94c41407d7fa4d4ac. No branch merge.

Execution plan:
- Freeze actual Production Worker version, all 30 bindings, secret names, D1,
  routes/domain, Cron, runtime/settings and payment/admin/model switches.
- Apply only recovery/abandonment, fast path, indexed preflight, merged durable
  local completion writes and their tests. Preserve Production site content,
  admin limits, provider support, prices, ledger and signup implementation.
- Test full suite, API/Web types, Production package/dry-run and old client parser
  plus delivery contracts. No remote D1, migration, historical data or model change.
- Prepare a compatibility rollback Worker: new recovery API with old preflight
  and local bookkeeping. Once new clients ship, do not blindly roll back to a
  Worker lacking recovery endpoints.
- Upload Production candidate with inherited live vars/secrets; verify all
  bindings/settings before 100% deployment. Verify public health/packages/auth.
- Package existing Store identity, Production origins only; no debugger or
  Staging diagnostics. User handles Chrome Store upload/submission per latest
  instruction. No browser/X test or real model call by Codex.

Release gates and final evidence are appended after execution. Real account
normal generation/recovery acceptance is reported separately from isolated tests.

## Verified release gate

- Full suite 785/785, zero failures/skips; API/Web types pass.
- Production Pages built locally using the existing public API and Site Key from
  the live login page; Pages are not deployed.
- Worker dry-run passes using live-derived config; no repository Wrangler defaults.
- Official Chrome Store public page confirms 0.3.2. New package version is 0.3.3.
- Official Google CRX3 0.3.2 SHA256:
  `0543022fc869c94c9154630248c74a8071b61b4464bbd48e3908d7db1694eeb5`.
  The old parser and its two dependencies are frozen in the test fixtures.
- Legacy/DeepSeek/Qwen fixtures cover missing/null/integer score, serialization,
  actual 0.3.1 and published 0.3.2 parsing, request replay, ACK and one debit.
- Recovery tests explicitly run with ENVIRONMENT=production. Permanent provider,
  uncertain request, ready-result preference, abandon/late result/concurrency,
  owner isolation, free/paid balances and budget protection remain covered.
- Payment files, prices, prompts, signup/device code, admin model implementation,
  site configuration, Web source and all migrations match fe7ac405 byte-for-byte.
  Staging SiliconFlow, model-test changes and the performance UI were not imported.
- No provider call, online D1 SQL or real X interaction by Codex. Live generation
  and recovery acceptance must be distinguished from these isolated assertions.

## Coordinated rollback

`api/scripts/build-pr16-compatible-rollback.mjs` builds a Worker that retains the
new recovery/abandon routes, ownership/rate limits, CAS and late-response fencing,
while restoring the original conservative quota prechecks. Its isolated test
verifies abandon, next generation, published-client parsing, replay and exactly
one debit. It does not reset any database data or re-enable old requests.

Before 0.3.3 distribution, original Worker 31f8c5a8-0883-4afc-88f3-7f67639f27f7
is a last-resort rollback. After new clients are distributed, prefer the tested
compatible rollback candidate or a reviewed fix-forward; do not remove recovery
endpoints from underneath new clients. Keep new clients' pending storage intact.
For an extension-specific regression, the user controls Store rollback where
available or a higher-version replacement based on preserved 0.3.2. Old and new
clients can coexist on the new/compatible Worker. Store rollback does not undo
server budget/ledger activity and no database restoration is part of code rollback.

## User acceptance / Store handoff

User handles all Chrome Store upload/submission per the latest instruction.
No Store upload, submission, cancellation or distribution change by Codex.
Confirm one normal generation with the existing account (one debit), and then
new-client recovery using a naturally failed request if available. Do not create
artificial Production failures, repeated model calls or payment orders to test it.
Staging recovery acceptance is complete; Production real-X remains a user check.
