# Production API-origin ownership transition — review checklist

The standard production release remains `--strict` (the default selection `api_origin_takeover=deny`). Cloudflare refused Admin V2's Worker release Run [#42979942867](https://github.com/Xuyysy/reply-copilot/actions/runs/42979942867) because the active production Worker was last modified through the Script API.

If and only if the owner explicitly approves a one-time Script-API-to-Wrangler source takeover, the same **manual, production-environment-protected** Action supports `api_origin_takeover=approve-after-review`. It then requires:
- The normal exact trusted source SHA, **independent full Push CI and Production build runs**, verified immutable artifact and historical rollback version.
- The normal Worker deployment confirmation `DEPLOY_WORKER_TO_PRODUCTION`.
- A **second** confirmation `ACKNOWLEDGE_WORKER_SCRIPT_API_SOURCE_OVERWRITE`.
- A separate **exact current Worker deployment ID** (`expected_current_deployment`), in addition to `expected_current` Worker version ID, both checked against live Cloudflare immediately before upload.
- Repeated read-only pre-upload guards of all configured vars, secret names, runtime compatibility date and D1 binding. The exact same after-upload guard verifies values, secret binding names and D1 identity remained unchanged.

Only in that explicitly approved Worker-only case is `--strict` omitted. `--no-bundle --keep-vars` remain; the compiled artifact is NOT rebuilt or altered. Strict remains enabled for every ordinary Worker release; Pages cannot select API-origin takeover. No D1 SQL, migration, receipt/entitlement mutation, or Chrome Store action is added.

**Review caveat:** The approval acknowledges that overwriting the prior Script API-edited Worker code is intentional. Before approving, reconcile the live Script API/0.3.7 hotpatch behavior with the exact release Worker bundle. Do not misinterpret binding equality as equivalent runtime behavior. Takeover changes release ownership and should receive human approval under existing production gate. The workflow will not run automatically after a merge.

**Stale-release caveat:** Every new launch must recheck the CURRENT Worker version, deployment ID and Pages ID. Do not reuse any prior IDs without inspecting live state.
