# CF Free — safe AI inference Worker CPU batch

Baseline: `62a767299ab1302a692338bc747071f19993fc60`, 2026-11-18. No live D1 SQL.

## Evidence and scope
The real Cloudflare account D1 reads on complete UTC days 2026-11-15/16/17 were 41,504,353 / 28,201,000 / 17,124,256; the observed maximum CPU values were 43.421/50.156/58.945 ms. CPU maxima were aggregates across mixed deployments, **not route attribution**. A passive 20-second version-pinned Production CPU profile sampled only root/idle and provided no attributable application code. It is **not** evidence that AI generation causes the maximum CPU tail or that Free will pass after this change.

Static source identified two certain and avoidable computations on the managed AI generation path:

1. `requestConfiguredModel()` called `validateModelOutput()` on the raw provider reply and then `serializeModelOutput(raw)`, redoing JSON parse, normalization, distinct-reply checks. It now safely serializes the **validated parsed object** once. Public `serializeModelOutput(raw)` continues full validation for replay and any other untrusted raw caller. The Worker generator still performs its independent post-provider validation; no proof/validation gates are removed.
2. `activeProvider()` re-imported the same AES-GCM decryption key for every request. Passing the Env binding as a WeakMap cache scope now shares one non-extractable CryptoKey import per identical secret and Env identity; another environment never borrows it, a changed key invalidates it, and rejected imports are evicted. Ciphertext verification still happens on each request, with config/version bound to AES-GCM AAD. The existing encryption function and public default decrypt caller behavior remain unchanged.

## CI and rollout requirements
- The test suite asserts 5 concurrent decryptions => 1 key import, isolated Env, key rotation, reject wrong config/key, malformed keys and failed-import retry, using **synthetic secrets and local WebCrypto only**.
- A provider test counts exactly one raw JSON parse while preserving full normalized contract. Existing paid generation, replay, ACK, settlement and risk tests remain mandatory.
- Do not promise CPU <10ms, nor do the 100k PBKDF2 password cost/migration parameters change. Obtain active route-level CPU evidence separately; Cloudflare Free remains NO-GO until an entire postrelease UTC day passes D1/CPU and authentication read/write quotas.
- No Staging/Production changes or remote D1 SQL (including read-only SELECT/PRAGMA), no schema, payments, password flags, secrets or real AI vendor requests. Staging-first validation and exact-SHA protected Production release remain required.
