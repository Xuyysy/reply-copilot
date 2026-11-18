# CF Free batch: on-demand exact ACK generation statistics (2026-11-18)

Source baseline: bb0215ec90d68b161f4e0d81712c525546b9051f.

## Actual Cloudflare D1 query evidence
Cloudflare account Query Insights (Analytics GraphQL only; no remote D1 SQL), partial 2026-11-18 UTC day, mixed deployed-version period:
- Admin per-user lifetime ACK-proven COUNT: 134,754 rows read over 8 executions.
- Admin month/today ACK-proven COUNT: 46,905 rows read over 3 executions.
These are historical observation windows, not current-release per-request causal attribution.

The existing 0021 partial delivery timestamp index is already suitable for month scans, but exact COUNT still walks historical ACK entries. Adding a similar index is not enough. Do not modify or backfill financial/event records.

## Implementation
- **New Pages opt in** to deferred generation stats using `view=overview&generation_counts=lazy`; the Worker then omits both keys and skips the historical count. Old Pages still requesting only `view=overview` receive the legacy exact numbers during Worker-first rollout. AI cost view also defers the count. Omitted means **not loaded**, never zero.
- Operator-initiated /v1/admin/dashboard?view=generations returns exact today/month ACK-only statistics using unchanged GENERATION_TOTALS_SQL.
- Operator user dialog requests /v1/admin/users/:uuid?view=light, preserving recent orders, credit ledger, usage and quota, with generations null.
- An explicit /v1/admin/users/:uuid?view=generations returns the same exact historical ACK-only lifetime count after admin auth and existence check.
- Existing no-view dashboard and user detail endpoints preserve identical exact shape/semantics for legacy clients.
- UI displays an explicit load/reload button and honest placeholder/error state. Asynchronous results from older refresh/user components cannot overwrite a newly loaded context.
- No payment, subscription, credit balance, refund, ACK, success classification, password, login or schema changes.

## Verification boundaries
- Isolated local workerd/Miniflare D1 synthetic 8,000 ACK rows measures exact count read cost, and source-level tests enforce no count on overview/light requests.
- Isolated SQLite API fixture verifies legacy parity, zero vs missing, explicit ACK-only results, admin role enforcement, and source query execution.
- Web regression tests check manual load, refresh/reset and no false zero.
- No Production/Staging SQL (even SELECT/PRAGMA), migrations, Cloudflare writes, real payment/AI calls or plan changes. CI/build and separately authorized staging-first deployment are release gates. Free remains NO-GO pending complete UTC-day account D1 read, CPU, write, storage and auth tests.
