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


## 2026-11-11: Production postflight false-alarm fix (review only)

Runs #42985842999 (Worker) and #42988245926 (Pages) successfully
deployed the pinned artifact, but the postflight guard reported a binding
difference. The guard wrote `binding_names` (Python tuples) into a JSON
snapshot, which round-tripped into lists; it then compared those lists
against fresh tuples. This was an unconditional type mismatch, not evidence
that Cloudflare changed a value. Independent live checks found the same
variables, secret *names*, D1 identifier and runtime configuration.

The proposed guard keeps `binding_names` JSON-native (lists of two
strings) and adds a bounded postflight convergence window (15 reads, up to
70 seconds). Every accepted result must simultaneously satisfy:

- Identical plaintext variables, secret *binding names* and binding
  name/type pairs; expected production flags, D1 ID and runtime date still
  validated by `check_bindings()`.
- A **new active** Worker version or successful canonical Pages deployment.
- Persistent drift, missing bindings, or absent new active release still
  fail closed, with **key-name-only** diagnostics. No secret values
  are printed, read, or stored by the new logging path.

Preflight version/deployment pins, the default `--strict`, manual
Production environment approval, immutable artifacts and all D1/payment
restrictions are unchanged. This PR is code-only; no deployment or D1 SQL.
