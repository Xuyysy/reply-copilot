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
