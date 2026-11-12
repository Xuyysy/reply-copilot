# Staging Prompt V3: speed-first offhand replies

This is an **opt-in experiment, not a shipped feature**. It was independently informed by public writing-style examples. No external skill/runtime, post-editing agent, classifier, or humanizer script is bundled.

## Isolation

- Default: existing V1/V2 prompts. The release-hash-protected `prompts/prompt-builder.js` remains byte-for-byte untouched.
- Only `ENVIRONMENT=staging` **and** `AI_PROMPT_V3_EXPERIMENT=1` **and** `outputSchemaVersion=2` use V3.
- The feature flag is not added to checked-in Staging Worker configuration. Nothing changes on an already-running Worker until an explicitly authorized Staging deployment and flag setup.
- Any Production environment, any V1 client, and Staging without the flag use the original prompt. No new network calls, response parsing, quota/ACK logic, user fields or storage.

## Why this version

V2 already tells the model to avoid canned enthusiasm, neat contrasts, fake experiences and sermons. V3 deliberately **replaces** its verbose OFFHAND HUMAN REPLY RULES instead of appending a second list. It sharpens plain language, concrete sideways reactions, and native JA/KO register while preserving every other input and the complete JSON/language policy.

The source inspiration projects are for offline human review only; none are installed in the live request path.

## Tests / comparisons

```bash
node --test tests/prompt-v3-experiment.test.js tests/prompt-builder.test.js tests/multilingual-compat.test.js
node scripts/benchmark-prompt-v3.mjs --out dist/prompt-v3-offline.json
```

The benchmark creates **synthetic** posts (30 per language, 120 total) and times only local prompt construction; no X fetch, database, AI, or cost. Its p50/p95 timings are NOT real request latency. Actual language correctness and human-likeness still require a consented A/B of real model outputs and native-speaker review. No user content or live API requests are logged.

## Later real A/B gates (not run yet)

1. User/operator-approved 30 authentic posts per language (120 total); blinded rating of three-reply sets for naturalness, post-specificity, correctness and sendability, with no fabricated facts.
2. Alternate V2 and V3 on the same source under the **same model configuration** in separate authorized Staging calls (these calls are billable). Never send the original requestId to both variants, and never put this variant into the idempotency fingerprint.
3. Compare p50/p95 *end-to-end* click-to-ready, first response, input/output tokens, JSON parse success, locale accuracy and refund/recovery outcomes. Roll back Staging V3 flag on any regression.
4. Promotion only after human review: no quality claim from synthetic tests alone. Keep the current Production Worker untouched.

## Safety

Do not deploy this entire release/production branch to Production: unrelated payments/D1 migration changes may exist. Do not run remote D1 SQL, paid AI evaluations or Staging deployment without explicit authorization. Feature-flag operator setup requires the normal Staging release gate.