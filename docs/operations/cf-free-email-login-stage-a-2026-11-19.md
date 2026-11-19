# CF Free Phase A: Optional email OTP login, NO Production deploy (2026-11-19)

Source base: `2557f25eeda29e01b3ed00a773e53056a6828b87`. Worker Free allows only 10ms CPU per HTTP request; the current PBKDF2 hash supports 100k/210k legacy iterations and could exceed this. A 10k hash is already supported but compromises password strength; email OTP avoids the password KDF for ordinary account sessions without rewriting user IDs, subscription rights, payment proofs or extension sessions.

## Candidate API (feature disabled by default)
- POST `/v1/auth/email-login/request`: generic response whether the email exists; only verified active ordinary users; 8-digit email code expires in 10 minutes; 60-second send throttle, per-IP and per-email hourly rate limits. Reuses existing Resend integration.
- POST `/v1/auth/email-login/verify`: exact 8-digit code, five attempts, transactional one-time claim and session cookie. The old `rc_session` session model is unchanged. No password PBKDF2 or role changes in these code paths; admin accounts excluded.
- `EMAIL_OTP_LOGIN_ENABLED` must be exactly `1` before either route can execute; missing/disabled returns 404. Off by default in all current Cloudflare bindings.
- `PASSWORD_LOGIN_ENABLED=0` is an independent **future cutover**, only after users have OTP access; it disables password entry before PBKDF2. Default remains enabled, so existing users are unaffected.
- The new table is **only** in `api/sql-proposals/0032_email_otp_login.sql`, not auto-executed migrations. No remote D1 SQL was performed. Schema must be independently approved and verified before the feature switch.
- Frontend changes are intentionally NOT included until separate staging sign-in and account-recovery QA; this is an API candidate, not a released user feature.

## Explicit tradeoffs and remaining blockers
- Email inbox possession becomes a login factor; email compromise, mailbox availability and Resend quota (Free 100/day) become risks. Password reset already relies on email possession, but admin accounts are intentionally ineligible.
- Rate limits, isolated send/verify purposes, HMAC codes, generic enumeration-safe response, one-time claim and standard session authorization are mandatory. A no-email result is not an authenticated user.
- This addresses only login PBKDF2 CPU. Existing password registration/reset and potentially other HTTP 200 routes can still exceed 10ms. Free is **NO-GO** until route-level CPU, full UTC-day D1 usage and migration/recovery pass.
- No direct D1 mutation, real payment, user notification, Secrets alteration or Worker/Pages deployment. Owner-approved migration and production release remain separate.
