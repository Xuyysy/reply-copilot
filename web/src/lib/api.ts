export const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(message: string, public code: string, public status: number) { super(message); }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
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
  try { body = await response.json(); } catch { throw new ApiError("The service returned an invalid response.", "INVALID_RESPONSE", response.status); }
  if (!response.ok) throw new ApiError(body?.message || "The service is unavailable.", body?.code || "SERVER_UNAVAILABLE", response.status);
  return body as T;
}
