# Non-blocking next Reply — isolated candidate (2026-11-21)

Customer requirement: a different requestId starts as soon as the user triggers a new Reply, regardless of another request still generating, awaiting ACK, failing, or network-uncertain.

Current Worker-only implementation: remove user-wide single-flight gates from subscription and permanent-credit reservation transactions. Independent atomic quota, per-request ACK, exact-source budget and proof controls remain. Chrome 0.3.12 fast-switch lives in a separate client candidate (#219) and MUST NOT be built from the older 0.3.9 manifest on release/production.

Must retain: same-request idempotency, unique requestId and bound payload, user/credit ownership, subscription daily used+reserved limit, account credit balance, global cost budget, rate limiting, ACK exactly-once debit, per-request timeout/release and extension editor binding.

Limitations: starting the next request immediately does not mean instant model output, unlimited credits or bypass of disabled AI/abuse limits. Existing pendingAiDelivery storage retains the latest envelope only; old unresolved requests can expire after 10 minutes and be recovered through the server's authenticated endpoint, but multiple simultaneously interrupted envelopes need a follow-up dedicated durable recovery design. Never claim that every switched-away draft can be restored.

Release gates: exact-source full CI plus separate release/production branch push CI and protected Production build; Worker release only via owner/manual environment. The user chose direct Production, but Staging E2E remains unverified. Chrome 0.3.12 is a separate release and cannot be downgraded. No Production Worker or Chrome Store deployed; no remote SQL.