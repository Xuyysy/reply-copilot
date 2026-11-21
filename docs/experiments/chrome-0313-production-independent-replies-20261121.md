# Chrome 0.3.13 Production candidate — independent Reply (2026-11-21)

Based exactly on Chrome 0.3.12 V3 Production release candidate e811641c7352765c18b2650a3d21241d39d9d3d5, never on the older release/production manifest 0.3.9. Manifest bumped for a prospective next store version; store version must be independently confirmed before submission.

Patch carries the fast-switch client code and regression cases from Staging Chrome PR #219 (different request IDs start independently, A→B→A serializes same-ID retry, old/new ACKs finish in either order). Production account state now preserves free+paid available credits after subscription daily quota exhausts. Sidepanel shows accurate purchase prompt and action for fully exhausted entitlement.

Separate compatible Production Worker candidate: PR #217 (Worker-only). Requires Worker deployment before any Chrome Store submission. No auto-posting, D1 SQL/migrations, payment changes, credentials, or Chrome Web Store action done by this candidate.

Known release limitation: single-slot pendingAiDelivery can lose a prior request's local recovery pointer after repeated fast switches and service worker restart (#220). Owner chose to skip real Staging E2E; this does not remove the outstanding P1 risk. Do not mark actual Production delivery complete without protected Worker release and a separately approved Chrome Web Store publishing/review step.
