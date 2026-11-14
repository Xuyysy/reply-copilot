# Production Prompt V3 — source-of-truth parity

Production Worker `reply-copilot-api-production` was surgically patched from live version `ce085015-01df-49e5-9891-62298e5d61b1` to version `837c5108-9553-44dc-baec-3ef4642143d2`, deployed `d536939d-ed26-4298-80af-14a4fb9930c4`. The change is confined to selecting the exact Staging-validated V3 writing rules when `outputSchemaVersion===2`. V1 and all non-prompt code were unchanged. Bindings preserved 42/42. Rollback target: `ce085015-01df-49e5-9891-62298e5d61b1`.

**Important:** This PR mirrors the online desired behavior in source, and is NOT a second deployment. Since `prompts/prompt-builder.js` is release-hash protected for old Chrome clients, it remains untouched. A separate static V3 builder duplicates that original template with only the tone-rule span replaced. The Worker selects it only on Production V2; there is no runtime find/replace, additional provider request, humanizer, or external dependency. Keep V2 language-policy changes in sync with the fork if the baseline is ever edited.

Before any future Production Worker release, reconcile with live Worker version `837c5108`, verify all live payment/subscription/AI model configurations and D1 bindings, and run the guarded release pipeline. A naive deploy of a different source SHA can silently revert V3; do not deploy this PR from an unreviewed branch or merge it into the Chrome ZIP PR.

Chrome Web Store ZIP 0.3.10 is built separately from client-only branch `release/chrome-0310-immersive-store-candidate-20261114`, SHA `80cd29d3c05611784a1f4a5778a4b5ba240aa518`. The ZIP itself does not bundle or deploy the server-side Prompt V3.
