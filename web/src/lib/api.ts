export const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL || (import.meta.env.DEV ? "http://127.0.0.1:8787" : "")).replace(/\/$/, "");

export type ApiDiagnostic = { stage: string; upstreamHttpStatus: number | null };

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number, public requestId?: string, public diagnostic?: ApiDiagnostic, public order?: unknown) { super(message); }
}

const refreshStages = new Set(["provider_config", "provider_request_signing", "provider_fetch", "provider_http_response", "provider_response_signature", "provider_response", "order_reconciliation", "unknown"]);
function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : undefined;
}
function safeDiagnostic(value: unknown): ApiDiagnostic | undefined {
  if (!value || typeof value !== "object") return undefined;
  const diagnostic = value as Record<string, unknown>;
  if (typeof diagnostic.stage !== "string" || !refreshStages.has(diagnostic.stage)) return undefined;
  const status = diagnostic.upstreamHttpStatus;
  if (status !== null && (typeof status !== "number" || !Number.isInteger(status) || status < 100 || status > 599)) return undefined;
  return { stage: diagnostic.stage, upstreamHttpStatus: status as number | null };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!API_BASE) throw new ApiError("官网 API 地址尚未配置。", "API_NOT_CONFIGURED", 503);
  let csrfHeader: Record<string,string> = {};
  if (options.method?.toUpperCase() === "POST" && !["/v1/auth/register", "/v1/auth/verify-registration", "/v1/auth/login", "/v1/auth/request-password-reset", "/v1/auth/reset-password"].includes(path)) {
    const csrfResponse = await fetch(`${API_BASE}/v1/auth/csrf`, { credentials: "include" });
    if (csrfResponse.ok) csrfHeader = { "X-CSRF-Token": (await csrfResponse.json()).csrfToken, "X-Reply-Copilot-Action": "1" };
  }
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...csrfHeader, ...(options.headers || {}) },
  });
  let body: any;
  try { body = await response.json(); } catch { throw new ApiError("服务返回的数据无效。", "INVALID_RESPONSE", response.status); }
  if (!response.ok) throw new ApiError(body?.message || "服务暂时不可用。", body?.code || "SERVER_UNAVAILABLE", response.status, safeRequestId(body?.requestId), safeDiagnostic(body?.diagnostic), path === "/v1/orders" ? body?.order : undefined);
  return body as T;
}
