import type { Env } from "./types";
import { ApiFailure } from "./types";

export const nowMs = () => Date.now();
export const uuid = () => crypto.randomUUID();
export function randomToken(bytes = 32): string { const data = crypto.getRandomValues(new Uint8Array(bytes)); return Array.from(data, (n) => n.toString(16).padStart(2, "0")).join(""); }
export async function sha256(value: string): Promise<string> { const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(""); }
// Importing an HMAC CryptoKey on every session and login request adds CPU
// work without improving secrecy. Cache per Env *identity* inside an isolate,
// never globally across different environment objects or rotated secrets.
// Weak keys let unused bindings be released; the stored key is non-extractable.
// A rejected import must not poison future requests.
const hmacEncoder = new TextEncoder();
type AuthKeyCache = {secret: string; key: Promise<CryptoKey>};
const authHmacKeys = new WeakMap<Env, AuthKeyCache>();
async function authHmacKey(env: Env): Promise<CryptoKey> {
  const secret=env.AUTH_HASH_SECRET;
  if (!secret || secret.length<24) throw new ApiFailure(503,"SERVER_UNAVAILABLE","认证服务尚未配置。");
  let cached=authHmacKeys.get(env);
  if (!cached || cached.secret!==secret) {
    cached={secret,key:crypto.subtle.importKey("raw",hmacEncoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"])};
    authHmacKeys.set(env,cached);
  }
  try {return await cached.key;}
  catch(error) {
    if(authHmacKeys.get(env)===cached)authHmacKeys.delete(env);
    throw error;
  }
}
export async function hmac(env: Env, value: string): Promise<string> {
  const key=await authHmacKey(env);
  const hash=await crypto.subtle.sign("HMAC",key,hmacEncoder.encode(value));
  return Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,"0")).join("");
}
export function utcIso(ms: number): string { return new Date(ms).toISOString(); }
export function shanghaiDay(ms: number): string { return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10); }
export function nextShanghaiReset(ms: number): string {
  const shifted = new Date(ms + 8 * 3600_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1) - 8 * 3600_000).toISOString();
}
export function requireJson(request: Request): void { if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new ApiFailure(415, "INVALID_CONTENT_TYPE", "请使用 JSON 请求。"); }
export async function jsonBody(request: Request, maxBytes = 16_384): Promise<Record<string, unknown>> {
  requireJson(request);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new ApiFailure(413, "INPUT_TOO_LARGE", "请求内容太长。");
  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes) throw new ApiFailure(413, "INPUT_TOO_LARGE", "请求内容太长。");
  try { const value = JSON.parse(body); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new ApiFailure(400, "INVALID_REQUEST", "请求格式无效。"); }
}
export function requireWebOrigin(request: Request, env: Env): void {
  if (request.headers.get("Origin") !== env.WEB_ORIGIN) throw new ApiFailure(403, "ORIGIN_DENIED", "请求来源无效。");
}
export function cookie(request: Request, name: string): string {
  const found = request.headers.get("Cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return found ? decodeURIComponent(found.slice(name.length + 1)) : "";
}
export function sessionCookie(token: string, maxAge: number): string { return `rc_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`; }
export function clearSessionCookie(): string { return "rc_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0"; }
export function extensionOriginAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  if (env.ENVIRONMENT === "production" || env.ENVIRONMENT === "staging") return Boolean(env.EXTENSION_ORIGIN) && origin === env.EXTENSION_ORIGIN;
  return !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
}
