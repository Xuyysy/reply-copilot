# Production GitHub Actions: build and guarded release

> Status: proposed in `codex/production-actions-release-gates`. **Adding these workflows does not deploy anything.** After PR merge, configure the `production` GitHub Environment before any manual release.

## Sources of truth

- Production release base: `883415cdd875f8113319c281ff1002061586bc45`
- Current Worker version before future releases: `02713430-0c1f-4edd-9677-8945721bb282`; deployment `938fa15d-bc21-4699-b275-6bad3f1081d5`
- Current Pages deployment: `c8296284-af5e-446a-971d-1aa9e1172c6c`
- Worker rollback candidate (older): `cf1dda8c-dfd4-420b-89cf-1dfe88b13fb2`
- Pages rollback candidate (older): `439248b5-b652-4a5b-89e1-255b65761e8c`
- Chrome Store 0.3.4 already submitted for review separately. No workflow uploads or publishes Chrome. Do not rebuild or resubmit the submitted ZIP just because a new CI bundle exists.

## Automatic build

`.github/workflows/production-build.yml` builds only on `main`, on PRs targeting `main`, or by explicit workflow dispatch. It never deploys. It uses Node 24, locked npm deps, Production preflight, TypeScript, Wrangler Worker dry-run, site-key-verified Pages, and an extension ZIP with the existing Store extension ID. Outputs one immutable artifact `production-build-<SHA>` with:
- `worker/index.js` precompiled Worker and `worker-config.json`;
- `pages/` compiled static files;
- `extension/reply-copilot-production-<manifest-version>.zip` with `provenance.json`;
- `release-manifest.json` exact SHA and SHA-256 for every artifact file.

`PUBLIC_TURNSTILE_SITE_KEY` uses the **public** Production widget key `0x4AAAAAAFhsvhYsTlFR6LIM`, independently verified as attached to `app.x-reply-helper.top` in Cloudflare. It is deliberately **not** the Turnstile private verification secret. If rotated, update this pinned *public* key and rebuild/review. This avoids missing-GitHub-variable failures (the `42557858692` failure). Do not configure a repository secret containing the site key; the server-side `TURNSTILE_SECRET_KEY` stays in Cloudflare Worker.

## Manual Production deploy (never on push)

`.github/workflows/production-deploy.yml` accepts manual dispatch **from main only and GitHub actor Xuyysy only**, deploys exactly one component, not both. A `production` Environment must contain:
- Environment **secrets**: `CLOUDFLARE_API_TOKEN` (least-privilege token scoped to existing Production Worker and Pages), `CLOUDFLARE_ACCOUNT_ID`.
- Environment **variable**: `PRODUCTION_RELEASE_READY=YES`, set only when intentionally enabling Releases.
- Add GitHub environment required-reviewer protection if available on the plan. GitHub Free private repositories may not have required reviewers; the owner-only manual dispatch and typed confirmation are additional safeguards, **not equivalent to GitHub enforced reviewers**.
- No MK99/payment/identity private keys in GitHub; those stay in Cloudflare Worker and are preserved by Wrangler `--keep-vars`.

Pass `source_sha`, successful `ci_run_id` (Reply Copilot CI, event `push`, branch `main`), successful `build_run_id` (Production build, same SHA / `push` / `main`), `target` (`worker` or `pages`), `expected_current` (Worker **version ID** / Pages **deployment ID**) and `confirmation` (`DEPLOY_WORKER_TO_PRODUCTION` or `DEPLOY_PAGES_TO_PRODUCTION`).

Example (illustrative only; obtain fresh IDs and exact current live versions):
```bash
gh workflow run production-deploy.yml -R Xuyysy/reply-copilot --ref main \
  -f source_sha=<APPROVED_40_CHAR_MAIN_SHA> \
  -f ci_run_id=<SUCCESSFUL_MAIN_CI_RUN_ID> \
  -f build_run_id=<SUCCESSFUL_MAIN_PRODUCTION_BUILD_RUN_ID> \
  -f target=worker \
  -f expected_current=<CURRENT_WORKER_VERSION_UUID> \
  -f confirmation=DEPLOY_WORKER_TO_PRODUCTION
```
The workflow independently authenticates the two successful run IDs and SHA, checks each artifact's SHA-256 and target configuration; checks live `PAYMENTS_ENABLED=1`, 9 Secret binding names, D1 UUID, all declared vars and current expected deployment, then uses **precompiled** Worker `--no-bundle --keep-vars --strict`, or uploads **only the verified static Pages** files. After deployment it checks that a new version became active and variables / Secret references / D1 did not change. It refuses on any mismatch. No remote D1 SQL, migrations, payment modification or browser interaction.

Release sequence: Worker first -> server smoke check / paid platform monitoring -> Pages second -> independent browser/manual acceptance -> Chrome Web Store manually, if a new Chrome version exists. **Do not treat a green build as permission to deploy.**

## Rollback

Every run records the approved previous Worker version or Pages deployment. If bad, stop subsequent rollout; manually restore Pages first if necessary, then Worker only after checking already-distributed Chrome versions for API compatibility. Do not perform an automatic blind rollback of payment or customer data. D1 changes are out of scope.

## GitHub notification hygiene

The initial branch-push experiment used `codex/production-*` triggers, which generated failed-action emails on multiple setup commits. It was replaced with push-to-`main` and PR-to-`main` only. The failed run `42557858692` stopped on missing `PRODUCTION_TURNSTILE_SITE_KEY` GitHub variable; it **did not deploy**. The public Production widget Site Key is now explicitly pinned to avoid that dependency. If you still want fewer emails, adjust GitHub Notifications > Actions; prefer correcting failures rather than hiding them.

## Remaining setup and scope

1. Review PR, allow standard and Production build CI to finish green, merge into `main`; source code already live in Production may be ahead of historical main, so review merge diff.
2. Create/verify `production` GitHub Environment secrets and arm variable; no credentials stored in code. The workflow is otherwise inert for deployments.
3. On subsequent `main` changes the CI and artifact builder run automatically. Releases require the owner to manually dispatch with the pinned run IDs and current deployed version.
4. Do not conflate this automation with PR #20, a separate Staging-only Issue comment trigger.
