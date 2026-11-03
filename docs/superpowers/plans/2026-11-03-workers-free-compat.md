# Workers Free compatibility investigation and candidate

Base1070dc79f0048ebe719055e1d8c925aed76c73f3; branch codex/workers-free-compat-20261103. No remote SQL, environment changes, deployments, secrets or subscriptions. Real model/payment/email/browser actions prohibited.

1. Collect readonly non-D1 Analytics/log capabilities and route attribution limits. Separate online billed CPU from wall time and local V8 samples. Exclude Nov2 audit incident from ordinary capacity baseline.
2. Build an isolated synthetic full-schema workerd harness, blocked external network, per-route sessions/admin, fixed valid provider outputs, signed synthetic callback, profile CDP/Profiler and D1 metrics. Reproduce native password hashing, normal session/auth, generate, ACK, dashboard, order reads, callback and cleanup. Validate local timing limitations before any optimization.
3. Make only evidence-supported small changes with failing tests first: imported HMAC key reuse if material (never cache authorization), redundant model normalization if proven (retain full validation), bounded/scoped expiry queries if plans show growth (preserve atomic rollback and idempotency).
4. Measure before/after in the same isolated harness; include warm/cold profile limitations, representative history sizes, rows_read/written and query plans. Never label local wall as billed CPU. Reject speculative financial rewrites.
5. Assess dashboard exact aggregate growth and design incremental summary initialization/atomic maintenance/recovery separately if not justified for this patch. Model user/generation/dashboard/isolate TTL scenarios using labelled inputs, not linear production promises.
6. Run full tests/types/build checks and review diff/security boundaries. Commit/push independent branch, create new Draft PR, keep PR10 and all online environments untouched. Deliver A/B/C/D with explicit unresolved Free10ms CPU and online-route evidence gaps.
