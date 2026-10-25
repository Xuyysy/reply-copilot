# Production initial administrator bootstrap

## Intent and boundaries

Provide a one-time, auditable way to bind the first already-registered Production user as the sole administrator. The user must already be active and email-verified; this tool never creates or verifies users. This turn only develops and tests the tool. It does not connect to Production D1, modify Production configuration, deploy, or perform the bootstrap.

## Goals and non-goals

- Require a stable user ID and expected email, checked together against Production D1.
- Require the exact existing Production Worker/D1 identity, an explicit execute flag, owner authorization flag, exact database confirmation, and typed confirmation.
- Atomically update `users.role`, insert the `site_administrator` binding, and add an `admin_audit_logs` record using D1 `batch()`.
- Preserve the existing administrator session, CSRF, and reauthentication rules.
- Add no application route, migration, new role system, or public admin-registration endpoint.
- Keep dry-run offline and read-only; never print the expected email or any secret.

## Approaches considered

1. **Permanent bootstrap API endpoint:** rejected because it expands the public application surface and is unnecessary for a one-time operation.
2. **Cloudflare D1 REST multi-statement query:** rejected because the REST batch transaction guarantee is not explicitly documented, while this operation requires all-or-nothing writes.
3. **Local-only Wrangler dev process with a remote D1 binding:** selected. Bootstrap code executes locally on loopback; only the database binding reaches the existing Production D1. The write uses the documented D1 `batch()` transaction, and Wrangler is never deployed.

## Safety design

The CLI defaults to offline dry-run. Execute mode requires all explicit gates and an interactive terminal. The generated Wrangler config is temporary, points only at the fixed Production D1 UUID, binds only `DB`, and sets `remote: true`; the local server binds to `127.0.0.1` and is stopped after one operation. An ephemeral random bearer token protects the local handler. The handler rejects non-Production environment or mismatched database identity before database access.

Preflight checks user existence, exact expected email, active status, verified timestamp, ordinary user role, no existing admin role, and no singleton binding. The atomic batch rechecks all conditions in its first statement, then inserts the singleton binding and an audit row. A constraint-backed sentinel makes a failed/no-op precondition abort the batch. Duplicate and concurrent attempts fail closed. The audit actor is the new administrator because no administrator exists yet; the reason records that this is the owner-authorized bootstrap utility.

## Validation

Tests cover successful bootstrap, each identity/status/role/binding precondition, repeated and concurrent attempts, batch rollback, wrong environment/database, and missing explicit authorization. Tests use local SQLite only; no Production D1 access is needed.
