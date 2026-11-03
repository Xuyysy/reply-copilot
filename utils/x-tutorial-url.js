// Shared by the admin API and website: only X content permalinks, never redirects.
// Validate the raw path too: URL parsing alone silently normalizes dot segments,
// backslashes, whitespace and explicit default ports.
export function isXTutorialUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  if (value === '') return true;
  if (!/^https:\/\/(?:www\.)?x\.com\//i.test(value) || /[\s\\%#]/.test(value)) return false;
  const raw = value.match(/^https:\/\/(?:www\.)?x\.com(\/[^?]*)(?:\?[^#]*)?$/i);
  if (!raw) return false;
  const path = raw[1];
  if (!/^(?:\/[A-Za-z0-9_]{1,15}\/(?:status|article)|\/i\/(?:status|web\/status|article|articles))\/[1-9][0-9]{0,19}\/?$/.test(path)) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['x.com', 'www.x.com'].includes(url.hostname) || url.username || url.password || url.port || url.hash) return false;
    const seen = new Set();
    for (const [key, item] of url.searchParams) {
      if (seen.has(key)) return false;
      seen.add(key);
      if (key === 's' ? !/^[0-9]{1,3}$/.test(item) : key === 't' ? !/^[A-Za-z0-9_-]{1,128}$/.test(item) : true) return false;
    }
    return true;
  } catch { return false; }
}
