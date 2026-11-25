# Dedicated Cloudflare Free CPU pilot — deployment **not authorized** (2026-11-20)

This package is a synthetic-only **cloud behavior probe** for the next CF Free investigation step. Nothing in this PR deploys, bills, downgrades or modifies existing Cloudflare resources. Deploying the pilot requires a separately approved, genuinely Free **new/isolated account**. Never deploy it into the existing X Reply Helper account or a Production/Staging Worker.

## What is isolated

- One uniquely named Worker: `xrh-cf-free-cpu-pilot-20261120`. It uses `workers.dev` only and has no route, custom domain, trigger, D1, KV, R2, production binding, real account, payment, email or AI provider.
- A SQLite-backed Durable Object class using the project's existing, unmodified `PasswordVerifierDO` and `verifyPassword` PBKDF2 implementation. No password is saved in object storage; no customer or project credentials are handled.
- Four **fixed, synthetic** stored hashes: 10k, 60k, 100k and 210k iterations. The same fixed fake password, fake pepper and fixed salt are used by the local/remote tester; the HTTP endpoint accepts neither passwords nor hashes.
- Only two authenticated HTTP endpoints: `GET /__pilot` identifies the test Worker and `POST /probe` verifies a fixed scenario using the HTTP Worker or DO RPC. Every request requires the separately set `PILOT_ACCESS_TOKEN` secret (minimum 40 characters). No client IP, personal data or request body is written to logs; observability is disabled in the checked-in Wrangler config.
- The remote smoke script refuses any endpoint other than exactly `https://xrh-cf-free-cpu-pilot-20261120.x-reply-helper-isolated-workers-free-cpu-pilot.workers.dev/`, requires explicit `--execute-cloud` and `--confirm-dedicated-free-account`, and sends at most 32 synthetic probes, sequentially. The script itself makes no Cloudflare control-plane changes.

## Offline verification (already part of normal repository CI)

```sh
npm --prefix api ci
node --test api/tests/cf-free-cloud-pilot.test.mjs
```

These are Miniflare/workerd local tests, so **CPU quotas are not enforced locally**. They verify the source, real private DO RPC, 4 legacy PBKDF2 work factors, positive/negative results, authentication rejection, network isolation, no secret echo, and safe report classifications.

## Independent approval needed before any CLOUD deployment

1. Verify through the **Cloudflare dashboard** that you have a *separate* Workers Free account, not the existing Production/Paid account. Confirm the account and that no existing names, billing settings or resources will be touched. The remote script's `--confirm-dedicated-free-account` flag is only an acknowledgment: it **does not prove** the account plan.
2. Have an operator review the exact PR SHA, script bundle, synthetic pepper, subdomain, `wrangler.jsonc` and rollback plan. Approve a narrow deployment *only into that separate account*. Do not provide real secrets to the source repository.
3. **Only after explicit approval**, from the repository's `api` directory with Wrangler logged into the isolated account, the operator can run:

   ```sh
   npx wrangler whoami
   npx wrangler deploy --config prototypes/cf-free-cloud-pilot/wrangler.jsonc
   npx wrangler secret put PILOT_ACCESS_TOKEN --config prototypes/cf-free-cloud-pilot/wrangler.jsonc
   ```

   `PILOT_ACCESS_TOKEN` must be a new cryptographically random 40+ character value. Ensure `wrangler whoami` is **not** the Production account, and inspect the Worker hostname before proceeding. The Worker fails closed until the access secret is present.

4. **Only after the isolated deployment and approval**, run from the root without printing the token in command history:

   ```sh
   export CF_FREE_PILOT_ACCESS_TOKEN='***set interactively or via secret manager***'
   node api/scripts/cf-free-cloud-pilot-probe.mjs \
     --execute-cloud --confirm-dedicated-free-account \
     --url https://xrh-cf-free-cpu-pilot-20261120.x-reply-helper-isolated-workers-free-cpu-pilot.workers.dev/ \
     --repeats 1
   ```

   Prefer loading the token directly from a private secret manager; never commit it or include it in screenshots, logs or bug reports. Full run: 16 synthetic requests plus one authenticated identity check. Up to 2 repeats (32 requests) only.

5. Store the **sanitized report** with the exact Worker version/commit and manually verified Free account plan. Capture Cloudflare's per-invocation CPU / `exceededCpu` outcomes separately for both the HTTP Worker and DO if available. The remote smoke script only measures client round-trip wall time and HTTP behavior: it **does not provide CPU milliseconds**. A Paid-account result can never certify Free.
6. After the bounded test, revoke the pilot access secret and **manually remove only the named isolated Worker and its newly created SQLite DO namespace**, verifying that neither remains. Confirm account identity again before any deletion. **Do not delete other namespaces, production resources or existing storage.** Do not run generic bulk-delete scripts.

## Interpretation and stop criteria

- Cloudflare Workers Free is limited to **10ms CPU per HTTP request**, **100,000 requests/day**. Consistently exceeding CPU may return Cloudflare Error 1102 / `exceededCpu`.
- SQLite Durable Objects are available on Workers Free; their per-invocation CPU is separately documented with a 30s default. The pilot must validate real behavior under the Free account. A DO call consumes a billed DO RPC request and is subject to daily request and duration caps.
- A `SYNTHETIC_SMOKE_PASS` proves only that a small set of **synthetic** direct and DO-verifier calls worked on the inspected account; it does not prove the full Reply Helper app, AI Generate, Delivery ACK, D1, Cron, storage or account-wide quotas will remain under Free.
- Any failure, unexpected 1102, missing deployed version, inability to verify the *actual* Free account, or absent independent per-component CPU evidence leaves **NO-GO**. No downgrade is authorized from this pilot.
- Previous PRs #213, #214 and #215 provide isolated local CPU profiles and aggregate readiness gates. They are not a replacement for a separately authorized Free account pilot. Production remains Paid.

**Documentation verified:** [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/), [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).


## Mandatory local Wrangler preflight (no Cloudflare account access)

The checked-in `api/package-lock.json` pins Wrangler `4.151.0`. Before any isolated Free-account deployment, run the following **locally** (it is also mandatory in the normal full CI):

```sh
npm --prefix api ci
node api/scripts/cf-free-cloud-pilot-dry-run.mjs
node --test api/tests/cf-free-cloud-pilot-dry-run.test.mjs
```

The preflight executes exactly `wrangler deploy --dry-run --outdir <temporary-folder> --config prototypes/cf-free-cloud-pilot/wrangler.jsonc` via the **locally installed** Wrangler binary. It strips Cloudflare account credentials and other ambient environment variables; it never deploys. It verifies the dedicated Worker config has only an allowlisted SQLite DO binding, no D1, routes or cron, and a fixed synthetic pepper. It checks actual bundled JS includes `PasswordVerifierDO` and the test marker. It records the uncompressed `Total Upload` size and removes the temporary bundle.

**Correct current size limit:** Cloudflare raised Workers Free **and Paid** to **64 MiB uncompressed** on 2026-09-04. The previous 3 MB Free **compressed** limit no longer applies; gzip is informational. Source: https://developers.cloudflare.com/changelog/post/2026-09-04-increased-worker-size-limit/ and https://developers.cloudflare.com/workers/platform/limits/.

Passing the dry run is only local packaging evidence. It does **not** establish the cloud Worker startup time, live CPU, DO execution limits, daily quotas, independently verified Free account plan, or permission to deploy. The existing explicit Free-account deployment authorization remains mandatory.

## Mandatory read-only account isolation check (2026-11-20)

Cloudflare read-only discovery from the currently connected account returned **exactly one accessible account**, and that account **contains the existing Reply Helper Production and Staging Workers**. Subscription lookup returned HTTP **403 Billing Read unavailable**. Therefore **this existing connection is NOT an isolated Free-test target** and must not be used for the pilot. This check did not change any resource, subscription or plan.

The next operator must use a **separate account-scoped read-only API token**, with only the target pilot account visible and no existing Worker scripts, to run:

```sh
# Obtain this ID from a different, separately created account; it must NOT be
# the Production account ID. Load the token from a secret manager, not a shell
# argument, source file or CI log.
CF_FREE_PILOT_READ_TOKEN=*** node api/scripts/cf-free-cloud-account-audit.mjs \
  --audit-read-only --expected-account-id <separate-account-id>
```

The tool calls only **GET** on Cloudflare's account list, Workers script inventory and account subscriptions. It fails closed if the token can see multiple accounts, the expected account ID does not match, Workers already exist, a Reply Helper Worker is present, or Billing Read is inaccessible. It prints only fixed reason codes—not account IDs, subscription IDs, emails, token values, Worker inventories or URLs. The tool **always returns NO_GO and exit code 2**, because even a successful read of an empty subscriptions list cannot independently prove that Workers Free is enabled.

**A manual Cloudflare dashboard inspection of the actual Workers Free plan, distinct account identity and a separately authorized rollout is mandatory after this audit.** The existing `--confirm-dedicated-free-account` switch on the optional remote smoke tester is only an operator acknowledgment, not plan verification; never interpret it as deployment approval. All direct deployment commands in this runbook remain forbidden until those additional checks and explicit approval are complete.

Do not add a CI token or an existing account ID to the repository. Do not upgrade/downgrade accounts, enable logs, delete Workers or create DO namespaces as part of this read-only audit.


## Offline-CI-tested real-network Free pilot runner (2026-11-20)

The Cloudflare connector cannot directly issue arbitrary authenticated outbound HTTP requests; Browser Run was rate-limited with a 50,092-second retry delay. The API surface did not expose a supported direct Worker invocation endpoint. Therefore the real cloud CPU behavior is still **UNKNOWN**; do not treat the connector's synthetic 403/404 as real Worker failures.

A one-shot executable runner now exists: `api/scripts/cf-free-cloud-live-run.mjs`. Run it ONLY from a normal **network-connected developer machine** after reviewing its code and confirming the isolated Workers Free plan in the dashboard. It is NOT executed by CI and does not modify the production account. It requires a short-lived Cloudflare API token restricted to this isolated account with Account Read and Workers Scripts edit/read (including DO inventory and Worker deletion). Never paste tokens into ChatGPT or commit them; use a private secret manager to load `CF_FREE_PILOT_API_TOKEN` without putting it in the command line.

From an unchanged checkout of the exact PR #216 head commit (confirm with `git rev-parse HEAD`), run `npm --prefix api ci` and then:

~~~sh
node api/scripts/cf-free-cloud-live-run.mjs \
  --execute-isolated-free-pilot \
  --confirm-workers-free \
  --confirm-delete-test-resources \
  --expected-account-id '<the separately created Free account ID>' \
  --expected-commit '<exact git rev-parse HEAD SHA>' \
  --repeats 1
~~~

The script requires `CF_FREE_PILOT_API_TOKEN` in the process environment. It pins the sole permitted account using its SHA-256 digest rather than publishing the ID, verifies an empty Worker and DO inventory, the exact account name and subdomain, and the clean source SHA. It uses the repo-locked Wrangler's credential-free dry run, deploys only `xrh-cf-free-cpu-pilot-20261120`, sets a randomly generated isolated Bearer token, invokes the existing synthetic fixed 16-case HTTP/DO probe using Node's normal internet-capable `fetch`, deletes **only** that test Worker with `force=false` even after partial failure, and verifies the account is again empty. It never echoes credentials in reports or CI logs.

**Important:** If `TEST_RESOURCES_NOT_CONFIRMED_REMOVED` occurs, immediately inspect the isolated account and manually clean up only the named experiment resources. A `SYNTHETIC_SMOKE_PASS` does not certify per-invocation CPU milliseconds, daily quotas, end-to-end app behavior or Production Free readiness. No downgrade, merge, payment change, or Production deploy is authorized.

## Read-only cloud CPU evidence after synthetic smoke (2026-11-20)

The one-shot network-connected runner now records a UTC test window and verifies the exact new SQLite Durable Object namespace ID. It deletes the experimental Worker and namespace first; only after successful cleanup does it query the official Cloudflare GraphQL Analytics API twice. Requests are GraphQL query operations, not configuration writes. The scoped test-account API token additionally needs **Account Analytics: Read**. Never grant access to Production.

- Worker query: workersInvocationsAdaptive filtered by the exact synthetic Worker name and UTC test window, obtaining request/error counts and grouped cpuTimeP50/cpuTimeP99 values.
- DO query: durableObjectsInvocationsAdaptiveGroups and durableObjectsPeriodicGroups, restricted during parsing to the exact test DO namespace ID, obtaining grouped request counts and aggregate periodic cpuTime. DO queries use a full UTC date and can include historical same-day events in that namespace.
- Validations: account identifier pinned to this test account, isolated namespace ID, <=15 minute same-day interval, results under 1000 rows, nonnegative finite metrics, no ambiguous or incomplete GraphQL results. No user data, cloud tokens or application secrets appear in the report.

**Important:** Cloudflare GraphQL CPU values are kept as raw, unit-unconfirmed numbers. The highest P99 across individual aggregation rows is not a true all-requests P99. DO periodic CPU total is not per-RPC CPU, and no raw GraphQL output certifies the 10ms HTTP Worker Free ceiling. Missing Analytics Read permission, delayed ingestion, absent namespaces or incompatible schema all fail closed. Status BOTH_COMPONENTS_OBSERVED_NOT_CERTIFIED is evidence of two component datasets, NOT a Free GO decision.

The runner now emits cpuNamespaceId and cpuEvidenceWindow (test-only infrastructure metadata, not secret), plus cpuAnalytics or an explicit analytics-unavailable error. If analytics take time to ingest, use the same normal network-connected workstation to requery without any deployment:

~~~sh
node api/scripts/cf-free-cloud-cpu-evidence.mjs \
  --read-only \
  --expected-account-id "<isolated Free account ID>" \
  --expected-namespace-id "<cpuNamespaceId from the report>" \
  --from "<cpuEvidenceWindow.from in UTC>" \
  --to "<cpuEvidenceWindow.to in UTC>"
~~~

Keep CF_FREE_PILOT_API_TOKEN private in environment variables, and revoke after collecting evidence. See Cloudflare official Workers GraphQL Analytics docs (https://developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/) and Durable Object GraphQL metrics docs (https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/).

No new cloud deployment has occurred for this code change. Production remains Paid and Free readiness remains NO-GO.
## Integrated candidate evidence rules (2026-11-25)

The probe now pins the exact isolated hostname and rejects redirects. `components.http` and `components.do` independently report behavioral passes and totals. An HTTP control failure does not establish a DO failure; a DO behavioral pass does not establish cloud CPU compliance. The overall smoke outcome and readiness gate remain fail-closed. A positive Free-plan confirmation and separate authorization for the bounded remote experiment are required; neither CI nor an empty account constitutes that authorization.
