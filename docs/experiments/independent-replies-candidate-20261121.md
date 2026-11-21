# Non-blocking next Reply — isolated candidate (2026-11-21)

Customer requirement: a different requestId starts as soon as the user triggers a new Reply, regardless of another request still generating, awaiting ACK, failing, or network-uncertain.

Current implementation: removed user-wide single-flight gates from subscription and permanent-credit reservation transactions. Independent atomic quota and cost budget remain. Hosted Chrome fast-switch no longer awaits superseded request recovery/abandon before dispatching the new request.

Must retain: same-request idempotency, unique requestId and bound payload, user/credit ownership, subscription daily used+reserved limit, account credit balance, global cost budget, rate limiting, ACK exactly-once debit, per-request timeout/release and extension editor binding.

Limitations: starting the next request immediately does not mean instant model output, unlimited credits or bypass of disabled AI/abuse limits. Existing pendingAiDelivery storage retains the latest envelope only; old unresolved requests can expire after 10 minutes and be recovered through the server's authenticated endpoint, but multiple simultaneously interrupted envelopes need a follow-up dedicated durable recovery design. Never claim that every switched-away draft can be restored.

Release gates: full CI, Staging E2E with two different posts and out-of-order completions, abnormal ACK/network failures, restart after old request, quota exhaustion, cost budget, payment/entitlement invariants. Draft PR only; no Production Worker or Chrome Web Store deploy, no remote SQL.