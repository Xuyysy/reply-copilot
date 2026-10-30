# Production AI model management release

Scope: model configuration/testing/activation/rollback, encrypted keys, and provider/model cost reporting. Default routing stays Legacy DeepSeek. No extension package or payment changes.

## Source and rollback baseline

- Feature source: `34730a93a7863734fed79efddfeffc4a4aebb55d`.
- Production Worker before release: `b423177e-afaf-482a-8390-f4dbea7bf880`, deployment `ff714929-bb36-4169-afc2-5a92dc172edf`. Its version annotation identifies `ea3bc7a`; all 32 API source-map entries in the retained release artifact match that commit. `ea3bc7a..c0e0f10` has no API changes.
- Production Pages before release: `16930289-fbcf-429f-ba61-de263bdc1589`, source `c0e0f104b236d2f1dfca66e269bfd568025d5781`. Other than the scoped model-management UI and necessary admin API request timeout support, the website remains on that baseline.
- Database: `d9df7d23-9b9c-44ac-a33a-c24474c15691`. Only `0018_ai_provider_management.sql` is pending. It adds model-management tables and nullable historical attribution columns; it does not update existing business rows or settings. Its runtime seed leaves the active pointer null.

## Compatibility

The released 0.3.1 parser was extracted verbatim from the retained release ZIP; fixture provenance records the ZIP and file hashes. Its hosted delivery client is byte-identical to the current source. Both parser versions accept the validated API wire format: absent/null optional score is omitted, valid integer scores are retained. Required fields and distinct reply checks remain strict. Existing cached null-score results are serialized compatibly without changing the saved result, request ID, model call count, or debit.

## Controlled release

Use `api/deploy/ai-model-production.wrangler.json` with **`--keep-vars`**. Its empty `vars` object deliberately avoids restoring obsolete disabled defaults from the older generic release config. Compare remote bindings to the secured pre-release snapshot before activating the candidate.

1. Export the Production D1 SQL into the protected backup directory outside this repository. Record its SHA-256, restore into isolated SQLite, run integrity/foreign-key checks, rehearse 0018, and compare every original table using only its original columns. Keep the SQL and restored 0017 copy. The restored and rehearsed copies must never be used as live database bindings.
2. Apply only the pending D1 migration through Wrangler's migration tracking. Verify 18 records, empty model configs, and a null runtime pointer. Preserve existing users, orders, ledgers, settings, and reservations.
3. Generate an independent 32-byte Production encryption key locally. Upload it additively with `wrangler versions upload --keep-vars --secrets-file <0600 temporary JSON> --config deploy/ai-model-production.wrangler.json`. Do not print its value. Delete the temporary file in a `finally` block. Candidate upload does not move live traffic.
4. Verify the candidate's D1 ID, every pre-existing binding/value, and secret names. The only added binding must be `AI_CONFIG_ENCRYPTION_KEY`. Preserve `PAYMENTS_ENABLED=1`, `ADMIN_PORTAL_ENABLED=1`, real AI, origins, and all existing credentials.
5. Deploy the verified candidate version to 100%. Build Pages with the exact live public Turnstile Site Key and `PUBLIC_API_BASE_URL=https://api.x-reply-helper.top`; upload only to `x-reply-helper-production` using its `main` deployment alias and the exact release commit hash.
6. Verify public health/packages, deny unauthenticated model/dashboard requests, compare uploaded static assets and live config, and confirm a null model pointer. Authenticated admin and Chrome/X checks are performed by the operator. Do not automatically run model tests, send mail, switch models, or create a payment.

## Stop and recovery

Stop on identity/config drift, missing backup, failed restore/integrity/rehearsal, any changed business setting, compatibility failure, or unexpected binding differences. Uploading a candidate is not permission to ignore those checks.

If code verification fails, deploy the recorded old Worker version through version deployment and roll Pages back to its recorded deployment. A newly added secret can make old-version rollback require explicit confirmation; inspect this first rather than silently forcing it. The unused new encryption secret may safely remain while legacy code runs.

Keep additive D1 tables/columns when rolling code back. Never restore the pre-release backup over a live database merely to undo this schema addition: that would overwrite any subsequent transactions. Use the verified SQL restore only for an explicitly authorized disaster recovery into an isolated/replacement database, followed by a separately reviewed reconciliation/switchover.
