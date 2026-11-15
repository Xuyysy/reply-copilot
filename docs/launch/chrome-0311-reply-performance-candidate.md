# Chrome 0.3.11 reply-performance release candidate (source-only, not published)

- Base: `release/production` (verify head before any merge). Branch source is a direct descendant of existing 0.3.10 candidate and the user-validated quoted-post and ordinary-post Staging improvements at `f11f119881ff7f1218810c932ea8265913cf2026` (Draft PR #137).
- Chrome manifest version and version_name bump from 0.3.10 to 0.3.11 because the user reports Chrome already has 0.3.10. Stable original Store item `fgfjajofkapebgphfidblngcjomkbdaj` and public key preserved.
- Builds PRODUCTION Chrome package using `npm run build:production` and `scripts/package-production-rc.py` within one pinned final Push CI, avoiding a second duplicate Actions job. Includes enhanced production-only ZIP inspection in CI; no Staging runtime, Stage scripts, prompts or APIs included.
- Real X acceptance: the user has tested quote-post auto-fill (PR #135), ordinary-post optimization (PR #137), and foreground local cold-start warmup (PR #138) in Staging. This does **not** independently validate full Production API, Chrome Web Store upload or review status.
- The 20-second keepwarm is internal to X foreground pages only, requires a top-frame origin, adds no permissions and does not call the developer API. Preserve Chrome MV3 suspension tolerance; no background-always-on claims.
- Exact code source, ZIP hash, full 1,244+ tests, Push CI and new production archive must agree. The full release/production workflow and manual approval remain prerequisites before calling this a deployed Production release.
- Never merge or deploy, upload to Chrome Web Store, access D1, change payment/secrets/Worker/Pages without separate explicit authorization. This PR is a Draft delivery candidate only.

## Cold-start inclusion

This candidate is built as a direct child of the user-tested PR #138 Staging SHA `f11f119881ff7f1218810c932ea8265913cf2026`; it includes precisely the foreground-local MV3 20-second keepwarm and two new tests for the page timer, plus a third worker sender/zero-network test. Last PR #138 full Push CI on exact SHA passed 1247/1247. This new version-only Production candidate must independently pass complete Push CI on its own SHA and produce a Production ZIP with the existing Store ID. Do not merge into release/production, upload to Web Store or deploy backend without separate explicit approval.
