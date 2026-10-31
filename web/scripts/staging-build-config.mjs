export const STAGING_API_BASE = 'https://api-staging.x-reply-helper.top';

export function resolveStagingApiBase(value) {
  if (value === undefined) return STAGING_API_BASE;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('PUBLIC_API_BASE_URL must be a valid URL for the Staging API.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_API_BASE_URL must be a valid URL for the Staging API.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('PUBLIC_API_BASE_URL must use an HTTPS origin.');
  }
  if (url.username || url.password || url.origin !== STAGING_API_BASE || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Staging Pages builds must use the Staging API origin ${STAGING_API_BASE}.`);
  }
  return STAGING_API_BASE;
}

/**
 * The Site Key is public and bound to staging.x-reply-helper.top; the matching
 * private TURNSTILE_SECRET_KEY stays exclusively on the Staging Worker.
 * Keep this fallback for local/Direct Upload builds, which don't inherit
 * Cloudflare Pages project env vars automatically.
 */
export const STAGING_TURNSTILE_SITE_KEY = '0x4AAAAAAFYdcIBnXxLTGrT4';

export function resolveStagingTurnstileSiteKey(value) {
  const key = value === undefined ? STAGING_TURNSTILE_SITE_KEY : value;
  if (typeof key !== 'string' || key.trim() !== STAGING_TURNSTILE_SITE_KEY) {
    throw new Error('PUBLIC_TURNSTILE_SITE_KEY must match the Staging Turnstile widget. Never use the Production Site Key in Staging.');
  }
  return STAGING_TURNSTILE_SITE_KEY;
}
