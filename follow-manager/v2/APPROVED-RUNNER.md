# Approved source → Follow sync → IndexedDB integration

`createApprovedFollowRunner` is the transport-neutral orchestration layer for the already-implemented Follow source adapter and persistence engine. This **does not implement network transport**, does not register Chrome listeners or permissions, and does not make an existing X website session available.

A reviewed, separately approved integration must supply `openTransport({binding,signal})` returning the explicit `currentBinding,readSelf,readPage,close` interface defined in `APPROVED-SOURCE.md`. The caller must pass a verified numeric `ownerUserId`, current handle, unique session binding, and **explicit authorized=true**. Unknown or unapproved sources do not open the IndexedDB or make requests.

The runner gates one active session, confirms the current viewer and self profile, checks counts on resume, commits each page via the existing IndexedDB lease, and requires both explicit termination and matching final counts before publishing a full local cache. Partial checkpoints remain partial; the shared relationship adapter deliberately remains unknown. A window closing does not call stop. A MV3 service worker termination may interrupt the runner; next user-initiated execution resumes from persisted checkpoint after re-verification, not automatic unattended execution.

The manager keeps only bounded status code and per-owner completion time in ephemeral controller state. It does not expose raw responses, request URLs, credentials, counters for other accounts, or input-dependent endpoint selection. The injected transport must enforce its own per-request budget and authorization scope; core `runAuthorizedSync` independently enforces the overall page/time budget.

Release gate: real platform-authorized transport, independent viewer identity source, real X compatibility, integration with the existing independent Follow workspace and staged backend, and exact-SHA CI remain outstanding. Synthetic Chromium tests prove offline state transitions and data handling, **not** actual X compatibility.
