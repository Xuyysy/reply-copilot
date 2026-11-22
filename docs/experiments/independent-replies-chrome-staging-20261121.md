# Chrome 0.3.12-derived Staging client candidate: no previous Reply wait

Parent e811641c7352765c18b2650a3d21241d39d9d3d5 is the verified Chrome 0.3.12 V3 Production ZIP source. No older 0.3.9 UI, no store ID change, no new permissions.

- The existing hosted fastPostSwitch option is true in the extension background worker.
- For different request IDs, skip synchronous old request recovery/abandon and immediately start a fresh request through the existing account-bound, server-authoritative delivery workflow.
- For the SAME request ID, retain immutable replay/fingerprint/ACK protocol. Do not auto-insert old drafts into a new editor.
- The server Staging API counterpart is PR #218; both sides MUST be tested together. The existing Production backend will continue enforcing the old per-user lock, so DO NOT upload this client to the Chrome Web Store or Production ahead of the separately approved backend rollout.
- Browser build artifact is for Staging developer mode only, not the signed Production Web Store package. Check the Staging extension ID, API endpoint, host permissions and build-info SHA.
- Full exact-SHA Push CI and Chrome two-reply E2E are release gates. Existing local pendingAiDelivery is single-slot and older interrupted requests can require the server's explicit recovery/expiry; no unlimited quota guarantee.
- NO Staging/Production Worker deploy, Chrome Web Store upload, remote D1 SQL, payments, secrets, subscription changes.
