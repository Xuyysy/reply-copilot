# Reply latency is a product invariant

For X Reply Helper, measure native Reply click → suggestions shown or safely
verified in the composer, rather than provider time or Worker CPU alone.

- The normal accepted request uses generate → idempotent ACK → display/insert.
  Recovery/history scans do not belong before a fresh generate request.
- Load independent local inputs concurrently and reuse the existing token-bound
  account precheck. Server authorization, frozen-account enforcement, budgets,
  reservation fencing and ledger assertions remain authoritative per request.
- Enter recovery only for an explicit local pending record, a server conflict,
  network/ACK uncertainty or user recovery action. Lost local state is not proof
  of completion; let the server detect it atomically, then resolve the actual
  pending request on the exceptional path.
- Preserve the original envelope and prioritize existing results. Explicit
  abandonment must be server-confirmed before creating a new requestId. A
  possibly delayed envelope must also be fenced when it differs from the
  actual server blocker. No automatic paid retry.
- Do not remove required prompt/history inputs, output validation, ACK,
  recoverable state persistence or native-editor verification merely to improve
  a latency number. Don't duplicate local reads or block on unrelated analytics.
- Compare identical inputs/model options with reproducible transport delays;
  report sample counts, cold/warm assumptions and inclusion relationships.
  Never sum nested model/Worker/network spans or present synthetic timing as
  real-X/provider latency. The 3s target still needs real-user confirmation.

Enforced by `tests/delivery-fast-path.test.js`, the recovery D1 end-to-end tests,
and the fixed-environment PR #16 benchmark scripts. These tests should prevent
future exceptional-state handling from adding normal pre-generation HTTP calls.
