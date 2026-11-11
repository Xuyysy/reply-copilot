# Reply Copilot — mandatory development workflow

This applies to **every existing, resumed and future** task in `Xuyysy/reply-copilot`, including ChatGPT, Codex, and other development agents. The latest user-approved policy lives in [Notion: unified CI-budget and release gates](https://app.notion.com/p/415c089052a381f0b031e1e9ab0283d3); check it and the actual GitHub branch state before working. If connected, fetch the user's enabled Notion skills at the start of each development session. **Do not substitute the old `main` branch for the real API/Web business code.**

## Check the target BEFORE changing files
- Read the actual PR/base/head SHA, current `.github/workflows/ci.yml`, recent Actions, and applicable release/deployment gate. Older branches do **not** inherit later CI changes automatically. Do not change another chat's Admin V2, Chrome, or payments branch without coordination.
- Confirm the exact expected branch head before writing; reject branch drift and avoid force push. Group 3–6 closely related changes when appropriate, using one atomic Git tree/commit or local batch rather than one push per file.
- Avoid empty-branch pushes, redundant artifact builds, repeated test reruns and commits that merely trigger CI. Local isolated test fixtures may precede pushing.

## CI minutes: WIP vs release
- **Intermediate, non-release commit:** only if the **current branch** already implements `CI_LITE_PUSH` and its ref is outside `release/**` and `staging/**`, start the subject with `ci-lite:` (exact prefix), e.g. `ci-lite: batch login UX fix`. This is a **non-releasable** fast Push run: API/Web TypeScript + focused browser-free tests; no Chrome full suite, Staging ZIP/Pages artifacts. An open PR still validates current merge context.
- **Old branches:** do not assume that a `ci-lite:` subject alone will save minutes. First inspect the actual workflow; if missing, integrate the verified CI-only configuration through an isolated, reviewed change without overwriting business files. Use the current production/Staging CI implementations as references, always read current SHAs.
- **Final/release candidate:** use a normal commit subject **without** `ci-lite:`; require a successful full `push` CI on the **exact final source SHA** (full `npm test`, Chrome/browser tests, Web+extension build, artifact SHA/provenance). Check actual logs, exit code, test counts, and artifact presence. PR/fast-green results are never substitute evidence. The production build workflow and manual approvals remain separate.
- Preserve fail-closed deploy gates, immutable exact-SHA provenance, the CI job name and real payment/security/ACK/regression tests. Never weaken a gate to reduce cost.

## Nonnegotiable safety limits
- **Absolutely no remote Cloudflare D1 SQL without fresh action-specific explicit approval**, including Staging, Production, backup, proxy `SELECT`, `EXPLAIN`, `PRAGMA`, export, or migration. Local isolated SQLite fixtures are allowed.
- Never auto-deploy Staging, Production, or Chrome Web Store from CI pushes. Deployment, secrets, payment/entitlement changes, and production data actions require distinct approval.
- Do not change GitHub Actions billing limits or turn off a $0 spending guard without explicit permission. Do not report a CI run as passed while it is queued/in-progress.
- Every delivery report includes branch and exact SHA, file list, tests/CI run links, build artifacts or why absent, deployment status, and approximate Actions cost.

## References
- [CI optimization PR #76](https://github.com/Xuyysy/reply-copilot/pull/76) / [Staging #80](https://github.com/Xuyysy/reply-copilot/pull/80): lightweight PR checks with full Push CI.
- [ci-lite PR #85](https://github.com/Xuyysy/reply-copilot/pull/85) / [Staging #88](https://github.com/Xuyysy/reply-copilot/pull/88): opt-in fast intermediate Push, full final Push.
- [Top-priority CI/CD and manual release policy](https://app.notion.com/p/412c089052a3813b8d99c4c4b60457c9).
