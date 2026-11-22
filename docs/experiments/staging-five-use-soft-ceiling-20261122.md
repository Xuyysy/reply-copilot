# Staging-only owner-scoped five-use subscription QA ceiling — 2026-11-22

## Why
The real D1 schema intentionally allows purchased subscription period daily_limit only in (500,1000,1500,2000). A fake 5/day paid period breaks the schema. Fabricating 495 past ACKs without corresponding ledger events also violates the accounting model.

## Implementation in Staging API PR #223
Two optional Worker bindings are **absent by default**:
- STAGING_QA_SUBSCRIPTION_FIVE=1
- STAGING_QA_SUBSCRIPTION_USER_ID=<the exact internal authenticated user ID of the dedicated Staging test account>

The 5/day ceiling applies **only if** ENVIRONMENT is exactly `staging`, both values match, the account has an **already valid, cryptographically/provider-verified paid subscription**, and today's true used+reserved <= 5. It is applied in both read-state (dailyLimit, remaining) and the atomic subscription reservation SQL (used+reserved<5). No plan or invoice is forged; subscription_periods keeps its real daily_limit of 500/1000/1500/2000; credits, paid proof, shared AI budget, receipt ACKs and ledger remain unchanged. Other Staging accounts and Production can never receive the override through those flags.

If the chosen account already consumed more than five subscription uses today, fail closed with STAGING_QA_DAY_NOT_FRESH; use a fresh test account or wait for its legitimate next subscription-day reset. Do NOT rewrite used counters or backfill fake ACKs to make the test pass.

## Expected real Staging E2E (dedicated test account only)
1. Before activation: choose a known owned Staging user with a valid active paid Basic subscription, whose current day has 0 used and 0 reserved. Identify the user ID through legitimate admin/account UI; do not run remote D1 SQL or log session tokens.
2. Separately approve a guarded Staging Worker release from the exact CI-passing PR #223 source. Compare all existing bindings: **32 plain-text + 27 secret-text + 1 D1**; the 17 live extra plain variables must be preserved; use `--keep-vars --strict`. Preserve old Worker version for rollback.
3. Separately approve settings modification for the two scoped QA vars; compare old/new binding fingerprints and ensure all other variables/secrets/D1 remain exactly unchanged.
4. Login to the Staging account; Chrome Staging build from #224 should show Basic dailyLimit=5, remaining=5. Each successful ACK decrements the subscription remaining once: 5→4→3→2→1→0; failed provider requests do not consume subscription.
5. After subscription reaches zero, generate with existing welcome free credits first and paid permanent credits only after free is actually exhausted. For an end-to-end 5+1+1+0 sequence, a **separate expressly authorized** dedicated test credit setup is needed; never mutate existing monetary/credit records just to shortcut a test.
6. Test fast A→B→C, out-of-order completions, lost ACK, reload MV3 worker, explicit sidepanel recovery and copy-only; no automatic X posting, no cross-account recovery.
7. Remove both QA vars after testing, verify the original paid subscription dailyLimit returns, restore expected Staging settings while leaving legitimate ACK history intact.

## Current safety status
No live Staging or Production deployment, D1 SQL (including SELECT), real subscriber modification, fake payment, credit grant, payment provider change, or Chrome Web Store release is authorized by this document. CI runs use local synthetic SQLite with verified mock events only. This is a source candidate and runbook, not an active server configuration.
