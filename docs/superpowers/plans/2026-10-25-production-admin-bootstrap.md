# Production Admin Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe, one-time local tool to bind an existing verified Production user as the unique administrator without adding a public endpoint.

**Architecture:** A local Wrangler dev process binds only to loopback and uses `remote: true` for the existing Production D1. A small shared handler validates identity and executes a D1 `batch()` transaction; a CLI enforces explicit target, owner-authorization, and typed confirmation gates. Dry-run never starts Wrangler or contacts Cloudflare.

**Tech Stack:** Node.js ESM, Cloudflare Workers D1 binding, Wrangler v4, Node test runner, `node:sqlite` for local transactional tests.

**Spec:** `docs/superpowers/specs/2026-10-25-production-admin-bootstrap-design.md`

## Global Constraints

- This task does not execute the bootstrap against Production D1.
- No Production secrets, deployments, D1 writes, migration, or Staging changes.
- No public bootstrap endpoint; local listener must bind `127.0.0.1` only.
- Existing users must be active, email-verified, and matched by stable ID plus expected email.
- Require no existing admin role and no `site_administrator` binding.
- Use one D1 `batch()` for role, binding, and audit writes; rely on documented transaction rollback.
- Preserve all existing admin session, CSRF, and reauthentication behavior.
- Never print email, secrets, tokens, or credential values.

## Review Focus

- Two simultaneous invocations: test serial D1 transactions and exactly one success.
- D1 `batch()` returning zero changed rows: test that the assertion aborts rather than committing partial role changes.
- Wrong target environment or DB UUID: test refusal before any DB method is called.
- Missing owner authorization or typed confirmation: test refusal before Wrangler starts.
- User email differs only by case: test according to the existing `NOCASE` email contract without printing it.

---

### Task 1: Bootstrap transaction core

**Files:**
- Create: `tools/production-admin-bootstrap/bootstrap.mjs`
- Test: `tests/production-admin-bootstrap.test.mjs`

**Interfaces:**
- `inspectBootstrapTarget(db, input)` returns only safe boolean checks and a stable reason code.
- `bootstrapAdmin(db, input, guard)` checks authorization/target identity and runs the transaction batch.

- [ ] Add local SQLite fixture from migrations 0001–0017 and tests for normal, absent, unverified, disabled, email mismatch, existing admin/binding, repeat, concurrent, wrong identity, and rollback scenarios.
- [ ] Run the targeted test to verify missing exports fail.
- [ ] Implement parameterized SQL, conditional assertions, D1 batch writes, and safe result codes.
- [ ] Run targeted tests and confirm all adversarial cases pass without persistent partial state.

### Task 2: Local-only Wrangler runner

**Files:**
- Create: `tools/production-admin-bootstrap/worker.mjs`
- Create: `tools/production-admin-bootstrap/run.mjs`
- Test: `tests/production-admin-bootstrap.test.mjs`

**Interfaces:**
- Local Worker accepts only authenticated `POST /inspect` and `POST /execute` requests.
- CLI supports offline dry-run by default and gated execution requiring `--execute`, `--authorize-production-bootstrap`, exact D1 confirmation, and typed user-ID confirmation.

- [ ] Add tests for wrong ENVIRONMENT/DB UUID, missing authorization, malformed input, and bearer-token rejection; verify DB is not touched.
- [ ] Confirm targeted tests fail before exports/handlers are implemented.
- [ ] Implement temporary config and `.dev.vars` in a mode-0600 temp directory, loopback-only Wrangler startup, one request, and cleanup/termination.
- [ ] Run targeted tests; inspect generated configuration logic to ensure only the fixed Production D1 is remote and no deploy command exists.

### Task 3: Operator documentation and repository integration

**Files:**
- Create: `tools/production-admin-bootstrap/README.md`
- Modify: `docs/launch/production-readiness-2026-10-25.md`
- Modify: `package.json` only if a non-network dry-run script is useful.

- [ ] Document dry-run and later execution syntax, authorization gates, output privacy, and the requirement for an already verified account.
- [ ] Update Production readiness to mark the bootstrap tool as prepared, not executed.
- [ ] Add tests for CLI parsing to ensure omitted authorization cannot reach Wrangler.

### Task 4: Final local preflight, commit, and push

**Files:** all intended local changes from this task plus the previously uncommitted readiness/config/test fixes.

- [ ] Run full `npm test`, API typecheck, Production config check, local Production preflight, Wrangler dry-run, Production web build, Production extension build, static API-origin scan, secret scan, and `git diff --check`.
- [ ] Verify build artifacts are restored and workspace has no unintended generated files.
- [ ] Commit all intended changes on `codex/v0.4-credits` and push to the existing GitHub branch; do not merge PR.
- [ ] Verify remote branch SHA equals local HEAD and working tree is clean.
