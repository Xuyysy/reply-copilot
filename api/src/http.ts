import type { Env } from "./types";
import { ApiFailure } from "./types";

const securityHeaders: Record<string,string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
};
export function response(value: unknown, status = 200, env?: Env, request?: Request, extraHeaders: Record<string,string> = {}): Response {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", ...securityHeaders, ...extraHeaders });
  const origin = request?.headers.get("Origin");
  if (env && origin && (origin === env.WEB_ORIGIN || origin === env.EXTENSION_ORIGIN || (env.ENVIRONMENT === "development" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)))) { headers.set("Access-Control-Allow-Origin", origin); headers.set("Access-Control-Allow-Credentials", "true"); headers.set("Vary", "Origin"); }
  return new Response(JSON.stringify(value), { status, headers });
}
export function failure(error: unknown, env: Env, request: Request): Response {
  const safe = error instanceof ApiFailure ? error : new ApiFailure(503, "SERVER_UNAVAILABLE", "服务暂时不可用，请稍后重试。");
  const headers: Record<string,string> = safe.retryAfterSeconds ? { "Retry-After": String(safe.retryAfterSeconds) } : {};
  return response({ code: safe.code, message: safe.message, requestId: crypto.randomUUID(), ...(safe.retryAfterSeconds ? { retryAfterSeconds: safe.retryAfterSeconds } : {}) }, safe.status, env, request, headers);
}
export function options(request: Request, env: Env): Response {
  const origin = request.headers.get("Origin");
  if (origin !== env.WEB_ORIGIN && origin !== env.EXTENSION_ORIGIN && !(env.ENVIRONMENT === "development" && /^chrome-extension:\/\/[a-p]{32}$/.test(origin || ""))) return new Response(null, { status: 403 });
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin || "", "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, Idempotency-Key, X-CSRF-Token, X-Reply-Copilot-Action", "Access-Control-Max-Age": "600", "Vary": "Origin" } });
}
