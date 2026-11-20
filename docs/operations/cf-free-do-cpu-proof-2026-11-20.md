# Local password DO RPC CPU proof — 2026-11-20

Run `node --test api/tests/cf-free-do-cpu-proof.test.mjs` or `node api/scripts/cf-free-do-cpu-proof.mjs` after `npm --prefix api ci`.

This builds the actual HTTP API and the existing PasswordVerifierDO prototype as independent local Miniflare/workerd Workers. D1 is initialized only from checked-in migrations and synthetic accounts; DO is SQLite-backed, private RPC-only, and uses a synthetic pepper. All outbound network fetches are blocked. No Cloudflare account, real D1 SQL, payment or production authentication is touched.

The test verifies 10k, 100k and 210k stored password hashes without rehashing; correct logins create exactly one session, incorrect passwords are rejected, and no external calls occur. It profiles the HTTP Worker and verifier Worker independently through local V8 Inspector. Reports include only fixed categories, sampled function names and Node-to-workerd round-trip wall times.

IMPORTANT: Worker Free has 10ms CPU per HTTP invocation. Durable Objects have their own CPU limits and Free quotas; moving PBKDF2 into DO only relocates the computation and does NOT establish full-Free compatibility. These measurements are local wall and sampled stack data, not real Production CPU, so the output always says freeCertified=false. Never enable PASSWORD_VERIFY_DO_ENABLED, modify pepper bindings, lower PBKDF2 iteration counts, or deploy without separate explicit authorization and a rollback review.

References: https://developers.cloudflare.com/workers/platform/limits/ and https://developers.cloudflare.com/durable-objects/platform/limits/.
