# Dedicated Cloudflare Free CPU pilot — deployment **not authorized** (2026-11-20)

This package is a synthetic-only **cloud behavior probe** for the next CF Free investigation step. Nothing in this PR deploys, bills, downgrades or modifies existing Cloudflare resources. Deploying the pilot requires a separately approved, genuinely Free **new/isolated account**. Never deploy it into the existing X Reply Helper account or a Production/Staging Worker.

## What is isolated

- One uniquely named Worker: `xrh-cf-free-cpu-pilot-20261120`. It uses `workers.dev` only and has no route, custom domain, trigger, D1, KV, R2, production binding, real account, payment, email or AI provider.
- A SQLite-backed Durable Object class using the project's existing, unmodified `PasswordVerifierDO` and `verifyPassword` PBKDF2 implementation. No password is saved in object storage; no customer or project credentials are handled.
- Four **fixed, synthetic** stored hashes: 10k, 60k, 100k and 210k iterations. The same fixed fake password, fake pepper and fixed salt are used by the local/remote tester; the HTTP endpoint accepts neither passwords nor hashes.
- Only two authenticated HTTP endpoints: `GET /__pilot` identifies the test Worker and `POST /probe` verifies a fixed scenario using the HTTP Worker or DO RPC. Every request requires the separately set `PILOT_ACCESS_TOKEN` secret (minimum 40 characters). No client IP, personal data or request body is written to logs; observability is disabled in the checked-in Wrangler config.
- The remote smoke script refuses any endpoint other than exactly `https://xrh-cf-free-cpu-pilot-20261120.<separate-subdomain>.workers.dev/`, requires explicit `--execute-cloud` and `--confirm-dedicated-free-account`, and sends at most 32 synthetic probes, sequentially. The script itself makes no Cloudflare control-plane changes.

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
     --url https://xrh-cf-free-cpu-pilot-20261120.<separate-subdomain>.workers.dev/ \
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
