# One-time Production administrator bootstrap

This tool is a local operator utility. It does not add an application route,
create a user, verify email, change passwords, deploy a Worker, or run a
migration. Production bootstrap has **not** been executed by preparing or
testing this tool.

## Preconditions

1. The existing Production website/API and email/Turnstile configuration have
   been deployed and verified in a separately authorized release window.
2. Register an account through the normal Production flow and complete email
   verification. Do not use an unverified or manually inserted user.
3. Obtain that account's stable user ID from a trusted authenticated account
   view. The expected email is used only for an exact identity cross-check.
4. Confirm the target is the existing `reply-copilot-production` D1 with UUID
   `d9df7d23-9b9c-44ac-a33a-c24474c15691`.
5. Obtain explicit owner authorization for the actual Production write. The
   code, tests, and local dry-run are not authorization to execute it.

## Offline dry-run

From the repository root, substitute the account's user ID and email:

```sh
node tools/production-admin-bootstrap/run.mjs \
  --user-id '<verified-user-uuid>' \
  --expected-email '<account-email>' \
  --target-database-id 'd9df7d23-9b9c-44ac-a33a-c24474c15691'
```

Default mode requires the ID, email, and exact fixed database ID arguments, and
prints the fixed target plus
`remoteOperationsExecuted=false` and `writesPerformed=false`. It does not start
Wrangler or connect to Cloudflare. It never prints the email.

## Authorized execution (later, separately approved)

Only after explicit owner authorization, run interactively in a trusted local
terminal with the existing Cloudflare account login. The tool requires all of
these independent gates:

- `--execute`
- `--authorize-production-bootstrap`
- `--target-database-id` and `--confirm-production-database` both equal to the
  fixed Production D1 UUID
- environment confirmation
  `CONFIRM_PRODUCTION_ADMIN_BOOTSTRAP=reply-copilot-production:<fixed D1 UUID>`
- an interactive prompt requiring the exact text
  `BOOTSTRAP <user-id> ON PRODUCTION`
- the account must pass a read-only D1 preflight: exact ID and email match,
  active, email-verified, ordinary user, no existing admin role, and no existing
  singleton binding

Execution starts **local** `wrangler dev` on `127.0.0.1` with a temporary config
containing only a `remote: true` binding to the fixed Production D1. It does not
use `wrangler deploy`, `--remote`, a route, `workers.dev`, or any other service
binding. A random bearer token protects the local handler. Temporary files are
created with owner-only permissions and removed on exit. The CLI makes one
preflight request, then at most one write request; an ambiguous write result is
reported as unknown and is never retried automatically.

The write uses a single D1 `batch()` transaction. It rechecks eligibility in
the first statement, sets `users.role='admin'`, creates the unique
`site_administrator` binding, and adds an `admin_audit_logs` row. A constraint
sentinel makes a zero-row/race condition roll the transaction back. Repeated or
concurrent initialization fails closed. The audit actor is the newly promoted
user, since no administrator exists before bootstrap.

After a separately authorized run, verify the role, singleton binding and one
`initial_admin_bootstrap` audit row through read-only checks before enabling the
admin portal. This document does not authorize that later operation.

## Local tests

```sh
node --test tests/production-admin-bootstrap.test.mjs
```

Tests create an in-memory SQLite fixture from repository migrations. They do
not connect to any Cloudflare account or D1 database.
