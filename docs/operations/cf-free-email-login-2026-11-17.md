# CF Free: opt-in email code sign-in for existing users (2026-11-17)

## Goal
Support low-traffic, low-fixed-cost operation by offering ordinary users a login method that avoids 100k/210k PBKDF2 processing inside the Worker. Existing password verification, password reset, registration, sessions, cookie/CSRF, licence/device binding, signup grant ledger, payments and USDT remain unchanged. The feature never changes the hash strength of an existing password. This is not sufficient alone to meet the 10ms Free CPU limit across all routes.

## Rollout controls (disabled by default)
- Backend Worker flag EMAIL_LOGIN_ENABLED=1 unlocks POST /v1/auth/login-code/request and POST /v1/auth/login-code/verify.
- Pages build-time flag PUBLIC_EMAIL_LOGIN_ENABLED=1 exposes the bilingual email-code option on /login. Both are OFF by default until explicitly enabled after Staging E2E.
- No D1 migration or remote SQL: uses already deployed email_verifications from 0001 and purpose-scoped HMAC. The legacy auth.requestCode/auth.verifyCode helpers remain unrouted; they share that table and should not be exposed without a separate interaction review.
- Staging first: build+deploy Worker and Pages under existing guarded workflows, verify that the challenge action is login, use controlled authorized test accounts and provider email sandbox. Validate normal/frozen/admin cases, one-use/replay, 5 failures, cooldown, no grants or trial created, device/license unaffected and old password login still works.
- Do not enable on Production, alter passwords, or switch Workers Paid to Free without fresh approval and complete all-account UTC-day readiness evidence.

## Cost/security boundaries
- Only a pre-existing, verified, unarchived, active normal user with no site_administrator assignment can obtain a login code and create a web session.
- Exact web Origin and Turnstile action login are required to request codes. Verify also checks web Origin. Default and reset/register Turnstile actions remain unchanged.
- Existing IP/email rate limiter, 60s email cooldown, ten-minute code lifetime, per-code five-attempt limit, atomic consume-and-session D1.batch and existing HttpOnly/Secure SameSite session cookie.
- Login-only global mail cap 40 per 24-hour fixed bucket (existing limiter); registration and reset mail use the same provider but separate quotas. Resend Free currently includes 100 emails/day and 3,000/month, but real account totals and provider changes must be watched.
- Mail provider failure and account absence have the same public reply to avoid account enumeration. Password remains fallback for mailbox problems and admin users.
- A stolen mailbox can give control of the normal account. Recovery, mail deliverability and owner acceptance matter before defaulting to passwordless-only.
- Expected CPU benefit: no PBKDF2 deriveBits on ordinary OTP sign-ins. Does not reduce CPU of password fallback, registration, reset, admin reauth or other expensive AI paths.

## Acceptance
Tests in tests/email-login-free-cpu.test.mjs use a local ephemeral SQLite database built from checked-in migrations only; CI must pass TypeScript, web build, full tests. The actual Workers Free switch remains NO_GO unless HTTP routes, account-wide D1 read/write and other quotas have clean post-deployment data and reasonable safety margin.
