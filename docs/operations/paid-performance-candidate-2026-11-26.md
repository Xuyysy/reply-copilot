# Paid performance candidate — 2026-11-26
Review-only, no deployment. Exact production source 96a3adde9e81d74d49e54b18a354dc68bf766fa7; source donor c1e5b32f3663d19e2bb9af6e590285800770b8c9. This is a selective extraction, not a merge of the Free research branch. Prior donor CI is not exact-candidate evidence.

Scope: generation preflight/settlement/replay, active model pointer snapshot, bootstrap fresh projection, admin role/binding snapshot, hexadecimal serialization, shared output validation, checkout-only active merchant credential checks, default-off zero-write atomic invariants. First Paid rollout proposal leaves CF_FREE_ZERO_WRITE_ASSERTIONS absent/off. No new migrations, index, dependencies, private DO, WASM, password-auth changes, prompt changes, MK99 key cache, extension release or deployment workflow changes. No live flags/secrets copied from repository defaults.

Full exact-SHA CI and isolated local Workerd six provider/funding combinations in both assertion modes on existing full index and native password path. Verify prompts, replies, quota omission, usage costs, ACK/replay, invalid-output release and zero external calls. Separate approval needed to enable zero-write. Human staging acceptance and explicit production authorization still required. Paid stays unchanged, no remote D1.

Previous V6 571/571 behavior and CPU samples; 62/571 >10ms, one late Cron exception. See chatgpt/cf-free-release-evidence-20261126 at 8450051cab0246750b0393f067e8908701e513e9. New candidate not Free certified or deployed.
