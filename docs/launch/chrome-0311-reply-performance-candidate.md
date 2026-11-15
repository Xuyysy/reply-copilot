# Chrome 0.3.11 reply-performance release candidate (source-only, not published)

- Base: `release/production` (verify head before any merge). Branch source is a direct descendant of existing 0.3.10 candidate and the user-validated quoted-post and ordinary-post Staging improvements at `7a4526acddf7b296b37346ddb98f43dfbe8f5575` (Draft PR #137).
- Chrome manifest version and version_name bump from 0.3.10 to 0.3.11 because the user reports Chrome already has 0.3.10. Stable original Store item `fgfjajofkapebgphfidblngcjomkbdaj` and public key preserved.
- Builds PRODUCTION Chrome package using `npm run build:production` and `scripts/package-production-rc.py` within one pinned final Push CI, avoiding a second duplicate Actions job. Includes enhanced production-only ZIP inspection in CI; no Staging runtime, Stage scripts, prompts or APIs included.
- Real X user acceptance: earlier PR #135 quote-post and PR #137 normal-post optimizations were tested by the user on Staging. This does **not** independently validate full Production API, Chrome Web Store upload or review status.
- Exact code source, ZIP hash, full 1,244+ tests, Push CI and new production archive must agree. The full release/production workflow and manual approval remain prerequisites before calling this a deployed Production release.
- Never merge or deploy, upload to Chrome Web Store, access D1, change payment/secrets/Worker/Pages without separate explicit authorization. This PR is a Draft delivery candidate only.
