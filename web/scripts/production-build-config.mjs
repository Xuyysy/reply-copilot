export const PRODUCTION_API_BASE = 'https://api.x-reply-helper.top';

export function resolveProductionApiBase(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('PUBLIC_API_BASE_URL must be a valid URL for the Production API.');
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('PUBLIC_API_BASE_URL must be a valid URL for the Production API.');
  }

  if (url.protocol !== 'https:') {
    throw new Error('PUBLIC_API_BASE_URL must use an HTTPS origin.');
  }
  if (url.username || url.password || url.origin !== PRODUCTION_API_BASE || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`Production Pages builds must use the Production API origin ${PRODUCTION_API_BASE}.`);
  }
  return PRODUCTION_API_BASE;
}

const TURNSTILE_TEST_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '2x00000000000000000000AB',
]);

export function resolveProductionTurnstileSiteKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,128}$/.test(value) || TURNSTILE_TEST_SITE_KEYS.has(value)) {
    throw new Error('PUBLIC_TURNSTILE_SITE_KEY must be a valid non-test Production Site Key.');
  }
  return value;
}
