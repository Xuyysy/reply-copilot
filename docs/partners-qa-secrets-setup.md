# Operator-only independent QA configuration

This setup is not a request for the owner to test the application. The owner configures credentials once; the operator executes the acceptance suite before handoff. Do not send secret values to chat, GitHub issues, commits, or logs. The blocked OIDC installation is retired, not retried.

## 1. Generate local-only files

Review api/qa/generate-operator-qa-credentials.mjs in this branch, then from your local clone:
```bash
git fetch origin chatgpt/partners-staging-qa-20261125
git show origin/chatgpt/partners-staging-qa-20261125:api/qa/generate-operator-qa-credentials.mjs > /tmp/partners-qa-credentials.mjs
node /tmp/partners-qa-credentials.mjs
```
Node 18+; no network inside the generator. It writes four files in a newly created private directory under your home, with restrictive permissions. No credentials are printed.

## 2. Configure only the independent Cloudflare Worker and D1

Cloudflare dashboard > Workers & Pages > reply-copilot-api-partners-qa > Settings > Variables and Secrets. Confirm the sole DB binding is 22f7a8f1-28c1-42ad-a69d-54ee8bc7e5dc; PAYMENTS_ENABLED=0; QA_SCHEDULED_ENABLED=0. Update **as secrets**, not plain text:
- QA_ACCESS_SECRET: contents of QA_ACCESS_SECRET.txt
- PASSWORD_PEPPER: contents of PASSWORD_PEPPER.txt

Keep AUTH_HASH_SECRET and PARTNER_ALIPAY_ENCRYPTION_KEY unchanged. Do not configure live merchant/email/AI keys. Never touch the similarly named shared Staging or production Workers.

D1 > reply-copilot-partners-qa-20261125 > Console. Verify the exact UUID above. Before applying anything:
```sql
SELECT (SELECT COUNT(*) FROM qa_schema_migrations) AS migrations,
       (SELECT COUNT(*) FROM users) AS profiles,
       (SELECT COUNT(*) FROM users WHERE password_hash IS NOT NULL) AS initialized,
       (SELECT COUNT(*) FROM sessions) AS sessions;
```
Expected 33,7,0,0. Only then run initialize-qa-only.sql from the local directory. It updates password hashes only for the seven synthetic IDs, with QA schema/zero-state guards. Expected initialized_qa_profiles=7. If any mismatch, stop. No changes to financial flags or records. SQL does not contain plaintext passwords or pepper.

## 3. Create GitHub Environment (NOT repository-wide secret)

https://github.com/Xuyysy/reply-copilot/settings/environments

Create partners-qa; under Deployment branches/tags choose Selected branches and tags, allow only exact branch chatgpt/partners-staging-qa-20261125. Configure required reviewer if your plan permits. Private repo environments require eligible GitHub plan; required reviewers may not be available on private repos. If these environment/branch restrictions are unavailable, stop and use a separately reviewed local operator testing route; do not fall back to repository-wide secrets.

In **Environment secrets** add PARTNERS_QA_CREDENTIALS with the full contents of PARTNERS_QA_CREDENTIALS.json. No Cloudflare API token, production/staging secrets, or OIDC exchange. Review .github/workflows/partners-hosted-secrets.yml before providing access. The workflow is push-only on exact branch, requires explicit approval marker 'ci-lite: qa-hosted approved', uses no checked-out code or external installation scripts with secrets in its environment. It sends credentials only to exact QA host, disallows redirects, logs safe labels/statuses only. It runs the real seven-account login/reauth/CSRF/role/logout matrix, not full hosted financial/browser acceptance. It has not yet executed with secrets.

Reply only that configuration is complete (or report which step failed, without secrets). Operator can trigger the approved QA workflow; inspect exact head and logs, no owner handoff until subsequent financial and browser acceptance pass. Do not create an approved-marker commit while configuring or before reviewing code. Default-off funding controls remain off for the login test.

## Cleanup

After internal tests and owner acceptance, revoke QA sessions, clear test password hashes only for these seven IDs, delete the GitHub environment secret, rotate the independent outer access secret, remove local plaintext files, disable QA endpoint if no longer required. Preserve synthetic financial ledger records; never delete financial history or touch existing Staging/production. If any test fails before logout, verify no active QA sessions before retrying.
