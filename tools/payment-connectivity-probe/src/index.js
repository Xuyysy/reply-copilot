const PUBLIC_HTTPS_TARGET = "https://example.com/";
const DEFAULT_TIMEOUT_MS = 5_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const encoder = new TextEncoder();

/** @param {unknown} data @param {number} [status] */
function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

/** @param {number} startedAt */
function elapsedSince(startedAt) {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) ? Math.round(Math.max(0, elapsed) * 100) / 100 : 0;
}

/** @param {unknown} value */
export function normalizeBaseUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  // Deliberately allow only an HTTPS authority with an optional trailing slash.
  // This rejects path prefixes, query strings, fragments, whitespace and controls.
  if (!/^https:\/\/[^/?#]+\/?$/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || !parsed.hostname || parsed.username || parsed.password) return null;
    if (parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.port) return null;
    return `${parsed.origin}/`;
  } catch {
    return null;
  }
}

/**
 * @param {"public_https"|"xiaodou_base"} test
 * @param {"http_response"|"fetch_rejected"|"timeout"|"configuration_error"} outcome
 * @param {number|null} httpStatus
 * @param {number} elapsedMs
 * @param {string|null} [errorCategory]
 */
function result(test, outcome, httpStatus, elapsedMs, errorCategory = null) {
  return { test, outcome, httpStatus, elapsedMs, errorCategory };
}

/**
 * @param {{test: "public_https"|"xiaodou_base", target: unknown, fetcher?: typeof fetch, timeoutMs?: number}} options
 */
export async function runProbe({ test, target, fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const normalized = normalizeBaseUrl(target);
  if (!normalized) return result(test, "configuration_error", null, 0, "target_invalid");

  const startedAt = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // Workers support redirect="manual"; never forward this probe to another host.
    const response = await fetcher(normalized, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const elapsedMs = elapsedSince(startedAt);
    if (REDIRECT_STATUSES.has(response.status)) {
      try { await response.body?.cancel(); } catch { /* The status is sufficient; discard body errors. */ }
      return result(test, "http_response", response.status, elapsedMs, "redirect_rejected");
    }
    try { await response.body?.cancel(); } catch { /* Do not turn a valid response status into a fetch error. */ }
    return result(test, "http_response", response.status, elapsedMs);
  } catch (error) {
    const elapsedMs = elapsedSince(startedAt);
    let name;
    try { name = error && typeof error === "object" ? /** @type {{name?: unknown}} */ (error).name : undefined; } catch { name = undefined; }
    if (controller.signal.aborted || name === "AbortError" || name === "TimeoutError") {
      return result(test, "timeout", null, elapsedMs, "timeout");
    }
    return result(test, "fetch_rejected", null, elapsedMs, "fetch_rejected");
  } finally {
    clearTimeout(timer);
  }
}

/** @param {Request} request @param {unknown} expectedToken */
function bearerMatches(request, expectedToken) {
  if (typeof expectedToken !== "string" || expectedToken.length < 32 || expectedToken.length > 256) return false;
  const authorization = request.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice(7);
  if (supplied.length !== expectedToken.length) return false;
  const left = encoder.encode(supplied);
  const right = encoder.encode(expectedToken);
  let mismatch = 0;
  for (let index = 0; index < right.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

/**
 * @param {Request} request
 * @param {{ENVIRONMENT?: string, PROBE_ENABLED?: string, PROBE_TRIGGER_TOKEN?: string, XIAODOU_PROBE_BASE_URL?: string}} env
 * @param {{fetcher?: typeof fetch}} [options]
 */
export async function handleRequest(request, env, { fetcher = fetch } = {}) {
  if (env?.ENVIRONMENT !== "staging" || env?.PROBE_ENABLED !== "1") return json({ error: "not_found" }, 404);

  const url = new URL(request.url);
  if (url.pathname !== "/run" || url.search || request.method !== "POST") return json({ error: "not_found" }, 404);
  if (!bearerMatches(request, env?.PROBE_TRIGGER_TOKEN)) return json({ error: "unauthorized" }, 401);

  const publicResult = await runProbe({ test: "public_https", target: PUBLIC_HTTPS_TARGET, fetcher });
  const configuredBase = normalizeBaseUrl(env?.XIAODOU_PROBE_BASE_URL);
  const providerResult = configuredBase
    ? await runProbe({ test: "xiaodou_base", target: configuredBase, fetcher })
    : result("xiaodou_base", "configuration_error", null, 0, env?.XIAODOU_PROBE_BASE_URL ? "target_invalid" : "target_missing");

  return json({ results: { public_https: publicResult, xiaodou_base: providerResult } });
}

export default {
  /** @param {Request} request @param {Parameters<typeof handleRequest>[1]} env */
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
