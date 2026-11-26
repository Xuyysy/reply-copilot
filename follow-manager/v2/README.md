# Follow Manager V2 — isolated fixture core

Base: a216f55028e91a3bf7187459531df46cdb0c00c1. Parallel work: PR #261 interaction-manager. No changes to shared manifest, build, sidebar, background, other modules, or existing archive databases. The staging build already copies follow-manager; open follow-manager/v2/workbench.html inside the extension manually. Final integration owns the entry switch; old archive UI is unchanged in this branch.

The only input is deterministic synthetic data. No X network transport, real session, credentials, permissions, or capture. No live API readiness claim. Production must not package/enable this workbench before final review.

Contract v1: stable decimal string IDs; nullable UserRef fields; per-owner records; explicit completeness. readFollowSnapshot(ownerUserId) intentionally returns unknown, empty map for any real consumer; fixture snapshots never cross the shared read interface. The real adapter requires separate authorization/validation. DTO names follow the joint architecture Notion page; interaction module must not write to this store.

Model, fixture, store and workbench use original code. IndexedDB jobs and rows commit each page atomically, lease rotation rejects stale writers, last full snapshot retained, six complete snapshots bounded. A complete result here means only synthetic counts matched; not proof of real X completeness. Resume explicitly takes ownership of the lease; no automatic request on opening the page. UI provides fixture sync, pause/resume, status, relationship categories, search, blue/unknown filter, pagination and CSV. No real identity bridge or live access. Browser IDB transaction/refresh/concurrency tests still required. Future work: authorized adapter, real ownership validation, coverage evidence, profile and whitelist features, integration tests with interaction read adapter.

Run node --test tests/follow-manager-v2-core.test.mjs. Full CI required before claiming a validated staging package. No deployment.
