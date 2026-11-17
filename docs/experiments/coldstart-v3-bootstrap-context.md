# Cold-start V3 — Staging source only (2026-11-17)

## Branch and evidence
- Parent: PR #174 (Staging prewarm V2), SHA b2eb89013fb7bd9bb00000c9a36d5065c0ff9cce.
- Chrome docs: events registered synchronously; static SW module imports run at worker startup; dynamic import() unsupported; MV3 SW may terminate after ~30s and must not depend on perpetual residency.
- Cloudflare docs: measure Worker module graph and startup CPU before trying expensive bundle refactors.

## Implemented
1. New GET /v1/extension/bootstrap **Staging only**: one bearer session check, read-only combination of the existing accountState() rules and user fields, no-store. Only extension sessions can call it; Production returns 404. No migrations, payment, AI, or quota changes.
2. Staging extension attempts one bootstrap request instead of /v1/me + /v1/entitlements + /v1/usage. The only fallback is an exact 404 NOT_FOUND from the old Staging API; all auth/network/schema failures remain fail-closed. Confirmed legacy 404 capability is remembered per Worker lifetime, avoiding repeated extra misses. No changes to Production client path.
3. In-memory 60s local generation-input cache (profile, reply style, selected history) preloaded along with V2 account warmup; invalidates on local settings/history/token modifications, fences in-flight reads. The full generation path still revalidates owner/entitlements and uses the existing server-side debit+ACK protocol. Production generation path unchanged.
4. Anonymous workerReadyAfterImportsMs diagnostic on existing local warm report; a measurement proxy after static imports, not a CPU profiler or proven performance improvement. No new network telemetry.
5. No new extension permissions or recurring server polling. No change to Chrome version 0.3.11.

## Release gates
- Full exact SHA Push CI and Staging artifacts; browser, payment, entitlement, content and ACK regressions.
- **Staging API Worker must be separately approved and deployed** for one-request bootstrap to be effective. Until then, old API returns 404 and extension safely falls back with an EXTRA request — do not claim a speedup in this mixed rollout state.
- Real Chrome A/B with SW DevTools closed, compare V2 and V3 on first boot, >1 min idle, and hot replies. Report P50/P90, success rate, API GET volume, workerReadyAfterImportsMs.
- No Staging/Production Worker or Pages deploy, Chrome Web Store upload, remote D1 SQL including SELECT, credentials, payments or subscription changes during code review.
