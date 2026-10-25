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
