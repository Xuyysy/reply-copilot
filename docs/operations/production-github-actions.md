# Production GitHub Actions: build and guarded release

> Status: implementation PR from `codex/production-actions-main-only`, using `release/production` for the actual pinned Production build source. **Adding these workflows does not deploy anything.** GitHub `production` Environment already has two secret names confirmed by user screenshots; actual values and token permissions still need the new read-only check mode.

## Sources of truth

- Production release base: `883415cdd875f8113319c281ff1002061586bc45`; build from dedicated `release/production` branch to avoid the divergent historical `main` source.
- Current Worker version before future releases: `02713430-0c1f-4edd-9677-8945721bb282`; deployment `938fa15d-bc21-4699-b275-6bad3f1081d5`
- Current Pages deployment: `c8296284-af5e-446a-971d-1aa9e1172c6c`
- Worker rollback candidate (older): `cf1dda8c-dfd4-420b-89cf-1dfe88b13fb2`
- Pages rollback candidate (older): `439248b5-b652-4a5b-89e1-255b65761e8c`
- Chrome Store 0.3.4 already submitted for review separately. No workflow uploads or publishes Chrome. Do not rebuild or resubmit the submitted ZIP just because a new CI bundle exists.

## Automatic build

`.github/workflows/production-build.yml` builds only on pushes to the controlled `release/production` branch or by explicit workflow dispatch on that branch. It never deploys. It uses Node 24, locked npm deps, Production preflight, TypeScript, Wrangler Worker dry-run, site-key-verified Pages, and an extension ZIP with the existing Store extension ID. Outputs one immutable artifact `production-build-<SHA>` with:
- `worker/index.js` precompiled Worker and `worker-config.json`;
- `pages/` compiled static files;
- `extension/reply-copilot-production-<manifest-version>.zip` with `provenance.json`;
- `release-manifest.json` exact SHA and SHA-256 for every artifact file.

`PUBLIC_TURNSTILE_SITE_KEY` uses the **public** Production widget key `0x4AAAAAAFhsvhYsTlFR6LIM`, independently verified as attached to `app.x-reply-helper.top` in Cloudflare. It is deliberately **not** the Turnstile private verification secret. If rotated, update this pinned *public* key and rebuild/review. This avoids missing-GitHub-variable failures (the `42557858692` failure). Do not configure a repository secret containing the site key; the server-side `TURNSTILE_SECRET_KEY` stays in Cloudflare Worker.

## Manual Production deploy (never on push)

`.github/workflows/production-deploy.yml` accepts manual dispatch **from main only and GitHub actor Xuyysy only**, deploys exactly one component, not both. A `production` Environment must contain:
- Environment **secrets**: `CLOUDFLARE_API_TOKEN` (scoped to existing Production Worker and Pages), `CLOUDFLARE_ACCOUNT_ID`.
- No `PRODUCTION_RELEASE_READY` variable is required. The user explicitly chose to avoid the extra YES/NO toggle; owner-only manual workflow dispatch, typed confirmation, pinning successful CI and build runs, live-state safeguards, and GitHub Environment access remain.
- Add GitHub environment required-reviewer protection if available on the plan. GitHub Free private repositories may not have required reviewers; the owner-only manual dispatch and typed confirmation are additional safeguards, **not equivalent to GitHub enforced reviewers**.
- No MK99/payment/identity private keys in GitHub; those stay in Cloudflare Worker and are preserved by Wrangler `--keep-vars`.

Pass `release_mode` (`check` or `deploy`), `source_sha`, successful `ci_run_id` (Reply Copilot CI, event `push`, branch `release/production`), successful `build_run_id` (Production build, same SHA / `push` / `release/production`), `target` (`worker` or `pages`), `expected_current` (Worker **version ID** / Pages **deployment ID**) and `confirmation`.

`check` is the **default** and strictly read-only: it validates both successful GitHub runs, every downloaded file, pinned Production configuration, access to the GitHub Environment secrets, live Cloudflare API reads, current Worker version/Pages deployment, all plaintext vars, 9 secret **names** and D1 **binding ID**. It cannot publish Worker/Pages and does not execute D1 SQL. Use `confirmation=CHECK_ONLY`.

`deploy` is explicitly selected later, and requires the matching `DEPLOY_WORKER_TO_PRODUCTION` or `DEPLOY_PAGES_TO_PRODUCTION` confirmation. This performs the same checks, then releases only that one component, followed by live postflight verification. Never infer a deploy from a check-only success. If GitHub Environment branch restrictions permit only `main`, invoke **both** modes on `main`; artifact source still comes from verified `release/production` CI.

Example: run the read-only preflight first. These exact run IDs and SHA were independently checked as successful on 2026-11-09; refresh the live version/deployment ID before initiating any future deploy:
```bash
gh workflow run production-deploy.yml -R Xuyysy/reply-copilot --ref main \
  -f release_mode=check \
  -f source_sha=42bea83125bb138f63316c6426416c9b4f7ef338 \
  -f ci_run_id=42559104204 \
  -f build_run_id=42559104202 \
  -f target=worker \
  -f expected_current=02713430-0c1f-4edd-9677-8945721bb282 \
  -f confirmation=CHECK_ONLY
```
After the preflight passes, an actual release requires manually rerunning the same workflow from `main` with `release_mode=deploy`, the target-specific `confirmation=DEPLOY_WORKER_TO_PRODUCTION` or `DEPLOY_PAGES_TO_PRODUCTION`, and a **fresh exact** `expected_current`. No workflow is launched by the documentation itself.

**Trusted-main toolchain caveat:** the historical `main` branch does *not* contain `api/package.json` or `api/package-lock.json`. Accordingly the manual workflow installs a specific reviewed Wrangler version (`4.151.0`) in an isolated temporary directory, as the existing Staging release workflow does. It never executes build/source scripts from the released `release/production` branch; the only deployed Worker JavaScript is the SHA-verified precompiled artifact.

The workflow independently authenticates the two successful run IDs and SHA, checks each artifact's SHA-256 and target configuration; checks live `PAYMENTS_ENABLED=1`, 9 Secret binding names, D1 UUID, all declared vars and current expected deployment, then uses **precompiled** Worker `--no-bundle --keep-vars --strict`, or uploads **only the verified static Pages** files. After deployment it checks that a new version became active and variables / Secret references / D1 did not change. It refuses on any mismatch. No remote D1 SQL, migrations, payment modification or browser interaction.

Release sequence: Worker first -> server smoke check / paid platform monitoring -> Pages second -> independent browser/manual acceptance -> Chrome Web Store manually, if a new Chrome version exists. **Do not treat a green build as permission to deploy.**

## Rollback

Every run records the approved previous Worker version or Pages deployment. If bad, stop subsequent rollout; manually restore Pages first if necessary, then Worker only after checking already-distributed Chrome versions for API compatibility. Do not perform an automatic blind rollback of payment or customer data. D1 changes are out of scope.

## GitHub notification hygiene

The initial branch-push experiment used `codex/production-*` triggers, which generated failed-action emails on multiple setup commits. It was replaced with only pushes to `release/production`; no generic development branch is subscribed. The failed run `42557858692` stopped on missing `PRODUCTION_TURNSTILE_SITE_KEY` GitHub variable; it **did not deploy**. The public Production widget Site Key is now explicitly pinned to avoid that dependency. If you still want fewer emails, adjust GitHub Notifications > Actions; prefer correcting failures rather than hiding them.

## Remaining setup and scope

1. Review the minimal automation-only PR to `main`; do NOT merge the full Production business tree into the divergent historical main. Ensure separate `release/production` branch green CI/build. The PR adds workflows/verifiers/documentation but does not deploy.
2. Create/verify two `production` GitHub Environment secrets; no deployment-ready variable or credentials in code. The workflow is otherwise inert for deployments.
3. On subsequent `release/production` pushes the CI and artifact builder run automatically. Owner first dispatches read-only `release_mode=check` from trusted `main` with pinned release-branch successful run IDs and live version. Only after verification, explicitly dispatch `release_mode=deploy` and typed authorization to actually release.
4. Do not conflate this automation with PR #20, a separate Staging-only Issue comment trigger.
