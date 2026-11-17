# Foreground account prewarm V2 (2026-11-17) — Staging source-only

## Why
The 0.3.11 candidate's 20-second local worker heartbeat (PR #138) reduces worker suspension on a focused X tab, but does NOT prime the 30-second cached AccountStateService. A cold/expired account state may cause three parallel API reads at the first Reply click, plus local preference reads. The existing PR #137 preflight starts at verified Reply click and is retained.

## Experiment
- In **Staging Chrome only**, content/coldstart-prewarm.js runs once on a focused visible X page, once on returning focus if at least 30 seconds elapsed, and on a **trusted human** Reply hover / keyboard focus / pointerdown if 30 seconds elapsed. No network polling loop.
- A new top-frame-only internal message REPLY_COPILOT_PREWARM_ACCOUNT asks the Worker to reuse the existing shared AccountStateService cache and read-only behavior preferences. Same 30s TTL, same existing owner/token invalidation and generation controls. It does NOT grant/revoke credits, fetch a model, publish, or ACK a generated reply.
- A single Worker-wide 30s cooldown plus in-flight promise dedupes tabs. Clicked Reply still uses the existing editor identity and entitlement precheck. Auth/plan changes invalidate the local cache and reset prewarm cooldown. No new permissions, remote SQL, server code, or payment modifications.
- Returns only anonymized readiness metrics. Content isolated-world replyCopilotColdStartReport() includes attempt counts, last RTT, Worker uptime, prewarm duration; never post text, URL, user ID, token or history. A <2s uptime suggests recent Worker startup but does not establish the full causal delay.

## Safety/limitations
- A focused X visit can cause up to three read-only hosted account API GET requests earlier than they would otherwise occur (already part of the ordinary account state path). Multiple foreground actions are bounded; this is NOT a zero-server-cost keepalive.
- No periodic remote polling. Cached status is NEVER treated as authorization to generate: trusted Reply DOM checks, authenticated Worker-side generation and server authoritative quota reserve/ACK stay intact. Weak/offline state follows pre-existing error/retry behavior.
- Production Chrome payload contains the helper file but the manifest-exposed Worker path is background/service-worker.js, so the prewarmer refuses to run; Worker independently also rejects it outside Staging.

## Required real-X acceptance before rollout
1. Use an unpacked Staging extension in a clean Chrome profile, DevTools for its Service Worker CLOSED. Observe first Reply after Chrome startup, 1min idle X foreground, and immediate subsequent reply (at least 10 trials each).
2. Compare on the same X posts against the exact 0.3.11 Staging baseline b2452789, with the existing performance report stages (reply_to_bind, precheck, dispatch_to_return, ACK, editor verification) and new replyCopilotColdStartReport().
3. Reject if extra GET volume is too high, failed/unauthorized users get misleading AI affordances, results are stale, replies are inserted into wrong editors, cancelled/switching requests run, ACK or credits change, or Chrome Store policy is questionable.
4. If prewarm provides no measurable P50/P90 user benefit, remove it; next experiments could target the worker module startup graph or an approved read-only bootstrap endpoint. Do not add offscreen/WebSocket/Chrome alarms without a separate security and store-policy review.

Not deployed to any Cloudflare Worker, Pages, Chrome Web Store, or runtime. No D1 SQL executed.
