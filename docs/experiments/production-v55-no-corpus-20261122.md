# Production V5.5 no-corpus release candidate — 2026-11-22

Owner approved after manual Staging trial. Confirmed Staging deployment 8b1e2716-77ba-4be8-b4eb-458230e29e93, version 11785c92-72e1-40f3-94b5-2069fcbaf8eb, exact source 76532ca5ef8993a338ebc283f6a71a324a484d23, 1252/1252 tests, successful guarded deployment 45000392191. Qualitative acceptance, not a measured benchmark.

Port only the common V5.5 no-corpus prompt, V4 static transform, and conservative V5 candidate preference onto Production 5f93a93282290fb9fca90b025f929a9ca75df645. Production baseline already includes the same language reminder. Original prompt-builder and V3 helper unchanged. New prompt and rerank only for Production schema-2. Legacy schema-1 unchanged. No corpus or retrieval code bundled. No payment, provider, quota, request hash, replay, ACK, D1, environment, Chrome or Pages changes. No remote SQL, migrations or live inference during CI.

Require full CI and independent artifact build on release/production push and existing protected owner-dispatched Production workflow with --no-bundle --keep-vars --strict. Exact prior Worker version e0fe6a88-9a72-4bcb-8a27-81baf4ec26b0, deployment ebb1c54d-c88f-400f-9946-44bc5f528ee3. Do not approve API-origin takeover. Worker only. Verify bindings and health after deployment. Candidate only until release completes.
