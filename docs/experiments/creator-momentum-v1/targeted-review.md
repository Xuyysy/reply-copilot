# Creator Momentum V1 targeted review

Review base: `547b26e714b76c1f08ef3656df895c898a7a53e0`. Fixed Production comparison source: `3cebe3ecbee552ef5b0e68afc7882a2dfb3869fa`.

## Findings

- The original toggle started an asynchronous refresh, then applied the click against the expired proof and wrote false. Explicit enable now verifies against the server before applying the same intent. Token/account changes invalidate the feature cache and old responses; an unavailable proof is neither a free classification nor a preference write.
- The original cold account check waited for a purchase join. The default entitlement route now performs no purchase-proof join. Feature lookup uses the same authenticated endpoint with an explicit query parameter; it may run on user interaction or after candidate display and fill, never as a prerequisite to the reply. Concurrent lookups share a request; stale proofs cannot authorize enable. A provisional local ACK receipt counts even when the policy has not yet been fetched.
- The purchase predicate is unchanged. Fixtures cover MK99's `xiaodou` protocol and `mk99` merchant tag, exhausted credits, gifts, refunds, risk/frozen accounts, and a valid order coexisting with an unresolved refund on another.
- No migration, new index, real transactions, remote D1 access, deployment, or installed-extension replacement.

## Workerd D1

Local synthetic fixtures, no remote requests. Existing query uses indexed lookups for settings and user, the payment provider/status index, the order primary key, and indexes for refund, credit batch and ledger evidence. Values below are D1 metadata rows read; each probe wrote zero rows.

| Orders | Pending only | No orders (before adding paid rows) | Old valid purchase among paid candidates | No qualifying proof among paid candidates |
|---:|---:|---:|---:|---:|
| 100 | 1 | 1 | 4 | 200 |
| 1000 | 1 | 1 | 4 | 2000 |
| 10000 | 1 | 1 | 4 | 20000 |

The paid/no-proof stress case remains linear. It is isolated from ordinary entitlements/generation, but monitor the optional feature call in Staging before considering any index or schema change. No claim of a bounded SQL worst case.

## Latency

P50 / P90, 12 measured samples per full-path variant. Actual orchestration with synthetic editor, D1 and transport; cache miss here is the extension account cache, not a Cloudflare cold start. ACK and persistence are part of the end-to-end number, not added to it. Mock transport excludes actual paid-proof query latency, measured separately above.

| Full-path variant | Display (ms) | Safe fill (ms) | Account precheck (ms) | ACK (ms) | ACK persistence (ms) | HTTP before display |
|---|---:|---:|---:|---:|---:|---:|
| Production source, cold | 157.54 / 158.88 | 238.97 / 241.02 | 30.44 / 31.74 | 24.90 / 25.45 | 11.80 / 11.95 | 5 |
| 547b26e, cold | 156.39 / 158.29 | 238.03 / 239.32 | 29.95 / 30.86 | 25.00 / 25.25 | 11.90 / 12.08 | 5 |
| Review candidate, cold | 157.02 / 161.17 | 238.66 / 242.46 | 30.46 / 31.91 | 25.00 / 25.33 | 11.82 / 12.05 | 5 |
| Review candidate, warm | 135.02 / 137.09 | 215.98 / 218.09 | 9.57 / 9.75 | 24.80 / 25.08 | 11.61 / 11.85 | 2 |

Real headless Chrome with synthetic editor, model, and ACK (12 samples per arm and case; fixed warm account; two generation/ACK requests; identical counts of blocking storage reads/writes):

| Isolated Chrome case | Production display / fill P90 (ms) | Candidate display / fill P90 (ms) | Local statistics P50 / P90 after fill (ms) |
|---|---:|---:|---:|
| paid_off | 88.30 / 89.10 | 88.60 / 89.30 | 6.40 / 7.30 |
| paid_on_below | 87.50 / 88.20 | 88.20 / 89.10 | 6.30 / 6.80 |
| paid_on_trigger | 88.30 / 89.00 | 87.80 / 88.40 | 6.30 / 7.30 |
| free_locked | 87.50 / 88.10 | 88.40 / 89.20 | 6.10 / 7.10 |

These tests support no material regression in the tested workload; they do not establish real X or production latency.

## Verification and handoff

- Full suite: 857 passed. API and Web type checks, local Staging extension build, Worker dry-run, and 375px dark-mode/keyboard Chrome test passed.
- Request separate approval before any deployment. Integrate only the feature delta into the current Staging Worker and Pages; preserve the existing installed extension. This build used Staging hosts, but has no embedded Staging public key, so loading it from a different path does not establish the existing approved extension ID.
- After approval, use controlled accounts to verify a free locked switch and CTA, a paid one-click enable after 60 seconds, offline retry and account switching. Use the Staging admin simulation for reminder stages; for real X latency, compare anonymized traces of ordinary replies and keep the current installation as rollback. No need for bulk model calls or real payments.
