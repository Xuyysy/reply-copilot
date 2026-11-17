# Exact SHA Staging Worker preview preparation

This manual GitHub Actions workflow on main is owner-only and uses the existing staging GitHub Environment. It validates a successful release/production full CI SHA, exact Staging Worker active version, Staging D1 database, the current Cloudflare binding types and all declared Staging variables (without printing their values).

Mode check (confirmation CHECK_ONLY) performs a dry-run compile only. Mode upload (confirmation UPLOAD_STAGING_VERSION_ONLY) calls Wrangler versions upload with keep-vars + strict and rechecks the unchanged Staging active version. **No traffic is deployed, no D1 SQL executes, no credential flag changes, no payment/USDT or Production settings change, and Cloudflare Free is not enabled.** Staging secret bindings are preserved according to Cloudflare Wrangler documentation. If the deployed configuration disagrees with the checked-in config, it fails closed.

For the merged 10k password-only candidate, use source SHA 6d954b16e43dbaaa3f92b24d3fc39fb5e49bec67, full CI run 44053755091 (successful), and confirm the current Staging version (ea96f683-eb16-43bb-b73a-78390b199ab8 at writing) before triggering.

Official docs: https://developers.cloudflare.com/workers/wrangler/commands/workers/ . A separate approval is needed for activating any version, enabling 10k credentials, migrating existing hashes and switching plans.
