# Production administrator model test limits release

Released on 2026-10-31 (Asia/Shanghai). Code: `57bf3d80ec31f6a45bc2845d43ee522a63eefbfe`, branch `fix/production-admin-model-tests-unlimited-20261031`, PR #5. Production Worker and Pages only; no database migration or direct business-data writes.

## Behavior and safeguards

- Removed the administrator-only 10-tests/day rate bucket and $0.05/day budget predicate. Tests still atomically reserve against the existing shared $5/UTC-day AI budget.
- Retained the $0.05 per-test estimated reservation ceiling, 30 requests/minute per administrator, administrator session/CSRF/re-authentication, unique test ID ownership, replay and single-settlement handling.
- Production's `ai_provider_test_budget_days.calls` has `CHECK(calls BETWEEN 0 AND 10)`. The obsolete metric now saturates at 10. `ai_provider_tests` contains the actual test records and count; no schema changes or counter resets were needed.
- The administrator confirmation explains the revised limits in Chinese and English. Saving or testing a configuration does not switch the active model.

## Source and build evidence

- The previous live Worker `09d19d8a-a489-443d-991f-bbb6bc254e20` had SHA-256 `adc144e27ac9d367ab77992d3fe956e7db2b31ec940797f6d6b13e4bf51f4beb`. All 42 source-map contents matched `e64bf2cf493c8a5e235665d798afc2116b6e0a91`. Candidate changes only `api/src/admin-ai-models.ts` among those sources; no signup-device-claim code/tables are present.
- Previous Pages deployment `0ad5fd22-eecb-4778-85e3-76844c163c19` identifies `e9125d7d7a90acfcb06ed3dfc02c28e7ecb2d8fa`. Website production-source diff is only the model-test confirmation text; a changed test synchronization is not shipped. All 11 non-admin HTML pages match the live baseline after normalizing Astro island IDs and Cloudflare email obfuscation. Existing privacy, terms, support details and payment pages are retained.
- Full `npm test`: **701/701 passed**. API TypeScript, Production Pages build and Worker dry-run passed. Added Production-environment regressions for a saturated legacy counter, old test spending above $0.05, per-test reservation rejection, the minute rate limit, concurrent global-budget reservation, replay and unchanged user credits.
- Production Pages was built with the existing Production API origin and public Turnstile widget. No Staging model, key or endpoint was copied.

## Deployment and checks

- Worker Version: `2019017b-b20f-461e-a1dd-414a2f845b8b`.
- Worker Deployment: `81491122-ea1d-4d87-acd1-0070770ec0ff`, **100%**.
- Live Worker SHA-256 matches the tested candidate: `15805616ad67326d50d826d6782fe7faa0bc7ed73b8e0f0275c040e626de629c`.
- Pages Deployment: `494810f2-3d2f-431a-99f3-87b77833718e`, success, exact release commit and `commit_dirty=false`.
- All 30 Worker bindings, plain values, secret names and observability settings match the recorded baseline. Secrets were inherited without reading values. Cron remains `0 3 * * *`. Qwen `qwen3.7-flash` v1, AI, purchase and payment configuration remain enabled, with the existing $5/day budget.
- `/health` and `/v1/packages`: HTTP 200; package response unchanged and `paymentAvailable=true`. Unauthenticated `/v1/admin/ai-models`: HTTP 401. Live admin bundle equals the local artifact and contains the revised Chinese/English confirmation.
- Production read-only checks retain the legacy CHECK and counter=10. Administrator test records and claims remain 13; test reservations=0, test settled amount=1411 micro-USD. No real administrator test was invoked by this release.
- Existing users generated during the release window: paid balance decreased by 19, matched by the most recent 19 `generation_debit` records, each -1 paid credit. Account/batch mismatches=0, duplicate generation-debit groups=0, negative accounts=0 and account reservations=0 at the check. These are live usage changes, not manual adjustments by this release.

## Operator validation

The authenticated live model-call check remains for the operator: refresh the Production administrator page and run one connection test on the existing configuration. Since the legacy day counter was already 10, a successful new test directly confirms operation beyond the old limit. Do not claim the offline mocked tests are a real upstream model call. This release did not send mail, create an order, invoke generation or change the active model.

## Rollback

Original Worker Version `09d19d8a-a489-443d-991f-bbb6bc254e20` and deployment `c8fe0c2a-4bda-47ee-a27e-cbd0b08214da` remain available. To restore old Worker code:

```sh
npx wrangler versions deploy 09d19d8a-a489-443d-991f-bbb6bc254e20@100% --config api/deploy/ai-model-production.wrangler.json --yes
```

In the existing `x-reply-helper-production` Pages project, roll back to deployment `0ad5fd22-eecb-4778-85e3-76844c163c19`. No database restore/migration is needed. Code rollback does not undo legitimate model-test spending or user generations; retain all existing ledgers. The old daily administrator test restriction returns with the old Worker.
