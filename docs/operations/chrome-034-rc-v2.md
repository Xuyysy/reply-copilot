# Chrome 0.3.4 RC V2

The integration base is e4e407b813a69b6b99e0240dd2ab2d7b5630dcff, which descends from the Production Pages commit 3cebe3ecbee552ef5b0e68afc7882a2dfb3869fa and includes the accepted Creator Momentum gate, floating UI and official copy. The speed R1 experiment contributes no runtime changes. The binding dialog changes were carried over selectively.

Cloudflare metadata inspected read-only: Production Pages deployment 439248b5-b652-4a5b-89e1-255b65761e8c recorded the historical Pages SHA. Worker deployment a044fc74-8628-47f3-9b51-8fae15e334d5 routed 100% to cf1dda8c-dfd4-420b-89cf-1dfe88b13fb2. These metadata do not prove the exact Worker source tree.

## Binding and compatibility

- The packaged manifest exposes external messages only on the respective first-party website. The Worker checks the actual HTTPS origin, exact account path, top frame, opened tab, matching device code, expiring local request and random proof. The proof is delivered in a URL fragment then kept in that tab's session storage through sign-in or registration. A copied device code cannot satisfy those checks.
- The trusted tab shows its signed-in identity and a short cancellation/account-switch window. Immediately before approval, the page rechecks the authenticated identity and extension proof. Approval uses the existing session and CSRF-protected endpoint. No page receives the private device token or bearer token.
- Exchange is single-flight within the extension Worker. The successful exchange writes the token, clears pending and writes a status receipt together. The website shows completion only after the extension has verified its account and matched the website identity.
- New website + older extension: existing explicit confirmation remains available. New extension + older website: the older confirmation still authorizes the same device request, which the new extension can exchange. Missing extension, expired proof or untrusted tab falls back to explicit confirmation where the device code is still pending.
- New extension + older API: existing device binding endpoints remain compatible. Creator Momentum follows the existing disabled/unavailable fallback for unsupported entitlement features. Old extension + new API: the device exchange and AI wire contracts are unchanged.
- If the network drops after the server consumes an exchange but before Chrome persists the token, the one-time code can be unusable. Restart the connection to create a new code. The API's one-time and per-installation grant protection remains authoritative.

## Build, rollout and rollback

GitHub CI builds on the RC branch using `REPLY_COPILOT_WEBSITE_URL=https://app.x-reply-helper.top REPLY_COPILOT_API_URL=https://api.x-reply-helper.top npm run build:production` followed by `python3 scripts/package-production-rc.py`. Rebuild from the provenance commit. ZIP metadata can differ across build hosts, so verify the uploaded artifact against its own recorded digest. Validate the live Web Store version before uploading.

Once separately authorized, record current environment versions and verify the actual Worker source/configuration. Release Worker first, then Pages, then upload the original Web Store item's ZIP. Validate old clients before each subsequent step. Review the live bilingual official copy and formal ranges (500–650 / 850–1100 / 1350–1700) through the audited admin UI. A stored policy overrides fallback copy. Test native Chrome/X binding and three-stage gating with an isolated paid account before store submission.

For regression, stop further rollout. Revert Pages to the recorded deployment, then roll back the Worker only after verifying clients already distributed can use its APIs. If the store update has already shipped, package a corrected build with a higher version; a Worker rollback does not downgrade installed extensions. Keep database records and user extension storage intact.
