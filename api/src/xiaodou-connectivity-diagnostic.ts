import type { Env } from "./types";
import { ApiFailure } from "./types";
import { takeRate } from "./auth";
import { requireStagingDiagnosticAdmin } from "./admin-auth";
import { hmac, nowMs, sha256, uuid } from "./security";
import { response } from "./http";

const DEFAULT_TIMEOUT_MS = 5_000;
const RATE_WINDOW_MS = 60 * 60_000;
const SAFE_ERROR_NAMES = new Set(["AbortError", "TimeoutError", "TypeError", "Error"]);

type ProbeResult = {
  connected: boolean;
  httpStatus: number | null;
  elapsedMs: number;
  exceptionName: string | null;
  category: "http_response" | "timeout" | "fetch_rejected" | "invalid_base_url";
  baseUrlSha256: string | null;
};

function parseRootBaseUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value || value !== value.trim() || value.length > 512 || value.includes("?") || value.includes("#")) return null;
  const authority = value.match(/^https:\/\/([^/?#]*)/i)?.[1];
  if (!authority || authority.includes("@")) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function safeExceptionName(error: unknown): string {
  try {
    const name = error instanceof Error ? error.name : "";
    return SAFE_ERROR_NAMES.has(name) ? name : "Error";
  } catch {
    return "Error";
  }
}

export async function performXiaodouConnectivityProbe(
  baseUrl: unknown,
  { fetcher = fetch, timeoutMs = DEFAULT_TIMEOUT_MS, now = () => Date.now() }: {
    fetcher?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<ProbeResult> {
  const url = parseRootBaseUrl(baseUrl);
  if (!url) {
    return { connected: false, httpStatus: null, elapsedMs: 0, exceptionName: null, category: "invalid_base_url", baseUrlSha256: null };
  }

  const baseUrlSha256 = await sha256(url.href);
  const startedAt = now();
  const controller = new AbortController();
  const timeout = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const result = await fetcher(url.href, {
      method: "GET",
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
    if (result.body) await result.body.cancel().catch(() => {});
    return {
      connected: true,
      httpStatus: result.status,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      exceptionName: null,
      category: "http_response",
      baseUrlSha256,
    };
  } catch (error) {
    return {
      connected: false,
      httpStatus: null,
      elapsedMs: Math.max(0, Math.round(now() - startedAt)),
      exceptionName: safeExceptionName(error),
      category: controller.signal.aborted ? "timeout" : "fetch_rejected",
      baseUrlSha256,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function xiaodouConnectivityDiagnostic(request: Request, env: Env): Promise<Response> {
  await requireStagingDiagnosticAdmin(request, env);
  // A single shared opaque bucket limits the outbound probe to one per Staging hour.
  const bucket = `xiaodou-connectivity:${await hmac(env, "staging-global")}`;
  if (!await takeRate(env, bucket, 1, RATE_WINDOW_MS, nowMs())) {
    throw new ApiFailure(429, "RATE_LIMITED", "诊断请求过于频繁，请稍后再试。", 3600);
  }

  const requestId = uuid();
  const result = await performXiaodouConnectivityProbe(env.XIAODOU_BASE_URL);
  const safeResult = { requestId, ...result };
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    route: "/v1/admin/diagnostics/xiaodou-connectivity",
    requestId,
    stage: result.category === "invalid_base_url" ? "base_url_validation" : result.category === "http_response" ? "fetch_response" : "fetch",
    category: result.category,
    exceptionName: result.exceptionName,
    httpStatus: result.httpStatus,
    elapsedMs: result.elapsedMs,
    baseUrlSha256: result.baseUrlSha256,
  }));
  return response(safeResult, 200, env, request);
}
