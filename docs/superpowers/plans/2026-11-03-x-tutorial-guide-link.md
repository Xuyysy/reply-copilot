# Configurable X guide tutorial

Scope: implement the user's specified guide button and Site Editor field only. No deployment, live business API/D1 access, migration, payment/model/auth/extension change.

## Verified source baseline

Read-only Cloudflare metadata on 2026-11-03: Production Worker ce100ea7-8170-4f3b-8a77-d5de573f1cad, deployment 6ca1cc5f-48cf-47f9-8ec8-e1ad8273e6b9, source1070dc79f0048ebe719055e1d8c925aed76c73f3. Pages80287593-230e-441a-9841-3a98e0f52823 source dc653487d8312abc8f4ceb64043c8fa200564fa2. `git diff dc653487 1070dc79 -- web` is empty. Isolated branch starts1070dc79; no unverified main/experiment changes.

## Design

Use the existing `site_content` JSON object and full-content save/history/restore mechanism. Add optional `xTutorialUrl` to CONTENT_KEYS, default empty for old content/versions. Reuse the existing one-fetch public content loader, language events, admin confirmation/CSRF/reauth/audit. A shared pure URL validator avoids API/browser drift; no URL is fetched by the server. Explicit X post/article permalink allowlist; exact x.com/www.x.com HTTPS authority; no credentials, port, escaped/control/normalized traversal paths or redirect parameters. Common share parameters s and t are bounded and unique. Supported paths: /user/status/ID, /i/status/ID, /i/web/status/ID, /user/article/ID, /i/article/ID, /i/articles/ID. Public button is initially hidden, only shown after independent validation, never hardcoded. Secondary button and wrapping actions preserve installation CTA and three steps. No new API/DB reads.

Alternatives: separate configuration API/table adds unnecessary auth/history/read complexity; hardcoding tutorial violates request. Existing content mechanism selected as required by user.

## Tasks and verification

- [x] Baseline site config/content tests pass12/12.
- [x] Add failing API validation, public lifecycle and authenticated save/history/restore tests (4 expected failures).
- [x] Implement validator, content field, editor input/save guard and guide button/wrapping.
- [x] Verify both languages, empty/new/updated/cleared links, editor save protection, history and mobile layout in isolated headless Chrome with mocked APIs; no real browser session.
- [x] Full suite738/738, API/Web types, Production build and isolated browser checks pass. Independent read-only review found no actionable issues.
Delivery: publish the isolated branch and open a review PR against the verified Production source branch; no merge or deployment.

## Later deployment (requires authorization)

Recheck current Worker/Pages metadata and drift against this baseline; rebase only if necessary. This change requires the Worker code update to recognize/persist the new CONTENT_KEYS field, plus Pages for editor/button. Deploy Worker first while retaining every live binding/secret/variable/route/Cron and current AI/payment/admin switches, then build Pages with verified Production API and existing public Turnstile key. No migration or Secret changes. Do not deploy stale local config blindly. Until Worker is updated, hide/disable feature rollout; old Worker ignores the new key.

After approval/deploy: administrator saves a real X tutorial through normal confirmation, refresh /guide, check new tab/destination and both languages; edit/clear/restore and recheck. No public tutorial is prefilled by this PR. Rollback Pages and Worker to recorded pre-release versions; keep current content/history records (old server ignores xTutorialUrl); do not restore a database backup or overwrite unrelated settings.

## Local acceptance evidence

Full `npm test`:738passed,0failed/0skipped (includes API authenticated content/history tests and isolated browser integration). `npm --prefix api run typecheck` and Web `tsc --noEmit` passed. Staging and Production Pages builds passed. The built page was exercised in isolated headless Chrome at1200/375/260px for both languages, initially empty/configured/updated/cleared content, language toggling, unchanged installation CTA/three steps, no horizontal overflow, and side-by-side desktop buttons. Editor checks verify invalid URL blocks save; valid/blank saves preserve existing content; history callback remains usable. Production-build browser verification repeats the same checks. No real administrator session, X page, external model or payment was involved.

URL validation is syntax/domain validation only: it does not prove an article exists or is public. The administrator should publish/select an accessible real tutorial at rollout. X’s [Articles help](https://help.x.com/en/using-x/articles) describes public sharing/audience controls; this PR does not alter those controls or bypass login restrictions on X.
