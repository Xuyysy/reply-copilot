# Follow V2 — approved source adapter

This is **not** a browser-authentication transport and does not make requests. Integrators must separately provide a reviewed, permitted `transport` with:

- `currentBinding({signal})` — independently checks the present local session and yields `{ownerUserId, handle, sessionId}`
- `readSelf({refresh, signal})` — an authenticated-self response identifying the **viewer** and self-profile separately: `{viewerUserId, profileUserId, handle, counts: {following, followers}}`; a list target is not a viewer identity proof
- `readPage({ownerUserId, kind, cursor, signal})` — one explicitly approved own-account read returning `{status, payload}`, bounded externally, without retries or mutations
- optional `close()` — stop an authorized source session

`createApprovedFollowSource` enforces local binding before/after network operations, profile/count stability, strict response shapes, target ID, status errors, and explicit terminal evidence. It returns the same `LIVE_SOURCE` `{readIdentity,page,close}` interface expected by `runAuthorizedSync`. Only the returned normalized page is eligible for the per-page IndexedDB commit. Unknown schema, unexpected identity, 401/403/429, ambiguous cursor or missing termination halt with no fallback.

**Release gate:** The adapter alone cannot access real X and does not prove platform authorization, actual current response compatibility or full list coverage. Do not wire a generic, untrusted message-defined transport or export credentials. Keep follow backend disabled until permitted source-specific transport and isolated real acceptance are available. No DOM scanning, archive import, passive interception, developer paid API, automatic follow/unfollow, or auth-token replay is added.

This lives solely under the Follow module and its tests. Shared Staging manifest, sidebar, build and background remain under the joint integration owner.
