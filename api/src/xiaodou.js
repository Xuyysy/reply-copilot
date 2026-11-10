const encoder = new TextEncoder();
const SIGNATURE_HEADERS = ["X-XD-Response-Sign", "X-XD-Response-Key-Id", "X-XD-Response-Timestamp", "X-XD-Response-Nonce"];
const EVENT_TYPES = new Set(["PAYMENT_SUCCEEDED", "PAYMENT_CLOSED", "PAYMENT_FAILED", "REFUND_SUCCEEDED", "REFUND_FAILED"]);
const WEBHOOK_STATUSES = Object.freeze({
  PAYMENT_SUCCEEDED: "SUCCEEDED",
  PAYMENT_CLOSED: "CLOSED",
  PAYMENT_FAILED: "FAILED",
  REFUND_SUCCEEDED: "SUCCEEDED",
  REFUND_FAILED: "FAILED",
});

export function webhookEventMatchesStatus(event) {
  if (!event || WEBHOOK_STATUSES[event.eventType] !== event.status) return false;
  if (!Number.isSafeInteger(event.eventAmountFen) || event.eventAmountFen < 0) return false;
  if (event.eventType === "PAYMENT_SUCCEEDED" || event.eventType === "REFUND_SUCCEEDED" || event.eventType === "REFUND_FAILED") return event.eventAmountFen > 0;
  return event.eventAmountFen === 0;
}

// This is Xiaodou's signed settlement projection, not the customer-facing
// package principal/service-fee snapshot. Never derive these values from rates.
export function validateFeeProjection(value, grossAmountFen) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Number.isSafeInteger(grossAmountFen) || grossAmountFen < 1) return null;
  const { ruleVersion, thresholdFen, tier, merchantRateBps, companyServiceFeeRateBps, merchantSettlementFen, companyServiceFeeFen } = value;
  if (typeof ruleVersion !== "string" || !/^[A-Za-z0-9._-]{1,64}$/.test(ruleVersion)) return null;
  if (!Number.isSafeInteger(thresholdFen) || thresholdFen < 0) return null;
  if (typeof tier !== "string" || !/^[A-Z0-9_-]{1,32}$/.test(tier)) return null;
  if (!Number.isSafeInteger(merchantRateBps) || merchantRateBps < 0 || merchantRateBps > 10000) return null;
  if (!Number.isSafeInteger(companyServiceFeeRateBps) || companyServiceFeeRateBps < 0 || companyServiceFeeRateBps > 10000) return null;
  if (!Number.isSafeInteger(merchantSettlementFen) || merchantSettlementFen < 0) return null;
  if (!Number.isSafeInteger(companyServiceFeeFen) || companyServiceFeeFen < 0) return null;
  if (merchantSettlementFen + companyServiceFeeFen !== grossAmountFen) return null;
  return { ruleVersion, thresholdFen, tier, merchantRateBps, companyServiceFeeRateBps, merchantSettlementFen, companyServiceFeeFen };
}

export function reconcileFeeProjection(currentStatus, currentJson, incoming, grossAmountFen) {
  const existing = typeof currentJson === "string" ? currentJson : null;
  if (incoming === null || incoming === undefined) {
    if (currentStatus === "verified" && existing) return { status: "verified", json: existing, issue: null };
    return { status: "review", json: existing, issue: "missing" };
  }
  const normalized = validateFeeProjection(incoming, grossAmountFen);
  if (!normalized) return { status: "review", json: existing, issue: "invalid" };
  const json = JSON.stringify(normalized);
  if (existing) {
    let prior;
    try { prior = JSON.stringify(JSON.parse(existing)); } catch { return { status: "review", json: existing, issue: "conflict" }; }
    if (prior !== json) return { status: "review", json: existing, issue: "conflict" };
  }
  return { status: "verified", json: existing ?? json, issue: null };
}

// Closed public error vocabulary from the Xiaodou integration specification.
const SAFE_PROVIDER_BUSINESS_CODES = new Set([
  "OPEN_API_HEADER_INVALID", "OPEN_API_SIGNATURE_INVALID", "OPEN_API_SOURCE_IP_REJECTED",
  "OPEN_API_RISK_FROZEN", "OPEN_API_APP_SUSPENDED", "OPEN_API_APP_REVOKED", "OPEN_API_MERCHANT_INACTIVE",
  "OPEN_API_BODY_INVALID", "OPEN_API_PAYLOAD_TOO_LARGE", "OPEN_API_REPLAY", "OPEN_API_REQUEST_ID_CONFLICT",
  "OPEN_API_IDEMPOTENCY_CONFLICT", "OPEN_API_RESOURCE_NOT_FOUND", "OPEN_API_STATE_INVALID",
  "OPEN_API_CHANNEL_UNAVAILABLE", "OPEN_API_CHANNEL_UNSUPPORTED", "OPEN_API_SCOPE_CHANNEL_MISMATCH",
  "OPEN_API_LIMIT_EXCEEDED", "OPEN_API_RATE_LIMITED", "OPEN_API_PROVIDER_REJECTED", "OPEN_API_GUARD_UNAVAILABLE",
  "OPEN_API_MERCHANT_DEPOSIT_BLOCKED", "OPEN_API_MERCHANT_COMPLAINT_HOLD",
  "OPEN_API_MERCHANT_CHANNEL_UNAVAILABLE", "OPEN_API_MERCHANT_SUB_OPENID_INVALID",
  "OPEN_API_MERCHANT_APPID_UNAVAILABLE", "OPEN_API_MERCHANT_APPID_INVALID",
  "OPEN_API_MERCHANT_RISK_BLOCKED", "OPEN_API_MERCHANT_BUYER_ID_INVALID",
  "OPEN_API_MERCHANT_BUYER_ID_REQUIRED", "OPEN_API_FEE_BEARER_DISABLED",
]);
const RESPONSE_FORMATS = new Set(["business_json", "other_json", "html", "other"]);
const SIGNATURE_STATES = new Set(["absent", "incomplete", "invalid", "verified"]);
const SOURCE_IP_REASONS = new Set([
  "PEER_NOT_TRUSTED", "FORWARDED_HEADER_PRESENT", "XFF_MISSING", "XFF_CHAIN_ABNORMAL",
  "XFF_LAST_INVALID", "REAL_IP_MISSING", "HEADER_CONFLICT",
]);

export function safeProviderResponseDiagnostic(value, upstreamHttpStatus = null) {
  if (!value || !RESPONSE_FORMATS.has(value.format) || !SIGNATURE_STATES.has(value.signatureState)) return null;
  return {
    format: value.format,
    providerCode: value.format === "business_json" && SAFE_PROVIDER_BUSINESS_CODES.has(value.providerCode) ? value.providerCode : null,
    signatureState: value.signatureState,
    sourceIpReason: upstreamHttpStatus === 403 && value.format === "business_json"
      && value.providerCode === "OPEN_API_SOURCE_IP_REJECTED" && SOURCE_IP_REASONS.has(value.sourceIpReason)
      ? value.sourceIpReason : null,
  };
}

function describeProviderResponse(response, text) {
  let parsed, isJson = false;
  try { parsed = JSON.parse(text); isJson = true; } catch { /* Never retain raw response text in diagnostics. */ }
  const businessEnvelope = parsed && !Array.isArray(parsed) && typeof parsed === "object"
    && typeof parsed.code === "string" && /^[A-Z0-9_]{1,80}$/.test(parsed.code)
    && typeof parsed.message === "string" && typeof parsed.requestId === "string"
    && parsed.requestId.length > 0 && parsed.requestId.length <= 128 && !/[\r\n]/.test(parsed.requestId);
  return {
    format: businessEnvelope ? "business_json" : isJson ? "other_json"
      : normalizeContentType(response.headers.get("Content-Type")) === "text/html" ? "html" : "other",
    providerCode: businessEnvelope && SAFE_PROVIDER_BUSINESS_CODES.has(parsed.code) ? parsed.code : null,
    signatureState: "absent",
    // A pre-auth error may be unsigned. This remains a diagnostic hint only;
    // signature verification and payment state handling are independent.
    sourceIpReason: response.status === 403 && businessEnvelope && parsed.code === "OPEN_API_SOURCE_IP_REJECTED"
      && parsed.details && typeof parsed.details === "object" && !Array.isArray(parsed.details)
      && typeof parsed.details.reason === "string" && SOURCE_IP_REASONS.has(parsed.details.reason)
      ? parsed.details.reason : null,
  };
}

export class XiaodouProviderError extends Error {
  constructor(code, status = 502, stage = "provider_response", upstreamHttpStatus = null, responseDiagnostic = null) {
    super("小豆支付暂时无法处理请求。");
    this.name = "XiaodouProviderError";
    this.code = code;
    this.status = status;
    this.stage = stage;
    this.upstreamHttpStatus = upstreamHttpStatus;
    this.responseDiagnostic = safeProviderResponseDiagnostic(responseDiagnostic, upstreamHttpStatus);
  }
}

export function xiaodouWebhookIsEnabled(env) {
  // Delivery verification must survive provider-sales toggles: old Epay and
  // RSA2 orders continue settling through their protocol-specific handlers.
  return env?.PAYMENT_PROVIDER !== "mock" && env?.XIAODOU_WEBHOOKS_ENABLED === "1";
}

export function xiaodouPaymentOrdersAreEnabled(env) {
  return ["xiaodou", "xiaodou_epay"].includes(env?.PAYMENT_PROVIDER) && env?.PAYMENTS_ENABLED === "1";
}

export function refundEventMatchesTransaction(event, refund, transaction) {
  return Boolean(event && refund && transaction
    && typeof event.outRefundNo === "string"
    && event.outRefundNo === refund.out_refund_no
    && typeof event.outTradeNo === "string"
    && event.outTradeNo === transaction.provider_trade_id
    && Number.isSafeInteger(event.grossAmountFen)
    && event.grossAmountFen === Number(transaction.amount_fen)
    && Number.isSafeInteger(event.eventAmountFen)
    && event.eventAmountFen === Number(refund.amount_fen));
}

function hex(bytes) { return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
async function sha256(value) { return hex(await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value)); }
function pemBytes(pem, label) {
  if (typeof pem !== "string" || !pem.includes(`-----BEGIN ${label}-----`) || !pem.includes(`-----END ${label}-----`)) throw new TypeError("RSA PEM is invalid");
  const base64 = pem.replace(`-----BEGIN ${label}-----`, "").replace(`-----END ${label}-----`, "").replace(/\s/g, "");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function encode3986(value) { return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`); }
function canonicalPath(path) {
  let decoded;
  try { decoded = decodeURIComponent(path); } catch { throw new TypeError("Canonical path encoding is invalid"); }
  if (!decoded.startsWith("/") || decoded.includes("//") || decoded.includes("\\") || /[\u0000-\u001f\u007f]/.test(decoded) || decoded.split("/").some((part) => part === "." || part === "..")) throw new TypeError("Canonical path is unsafe");
  return decoded;
}
export function canonicalQuery(query = "") {
  const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
  return [...params.entries()].map(([key, value], index) => ({ key, value, index })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : a.index - b.index).map(({ key, value }) => `${encode3986(key)}=${encode3986(value)}`).join("&");
}
export function normalizeContentType(value) { return value ? value.split(";", 1)[0].trim().toLowerCase() : ""; }
export async function canonicalRequest({ method, path, query = "", timestamp, nonce, appId, keyId, requestId, contentType = "", rawBody = "" }) {
  return ["XD-Signature-v1", method.toUpperCase(), canonicalPath(path), canonicalQuery(query), timestamp, nonce, appId, keyId, requestId, normalizeContentType(contentType), await sha256(rawBody)].join("\n");
}
function readHeader(headers, name) {
  const value = headers instanceof Headers ? headers.get(name) : headers?.[name];
  if (typeof value !== "string" || !value.length || /[\r\n]/.test(value)) throw new TypeError(`Required header is invalid: ${name}`);
  return value;
}
function readWebhookHeader(headers, name) {
  try { return readHeader(headers, name); }
  catch { throw new XiaodouProviderError("INVALID_WEBHOOK_HEADERS", 401); }
}
function timestampIsFresh(timestamp, now) {
  if (!/^\d{1,10}$/.test(timestamp)) return false;
  const delta = Math.abs(Math.floor(now / 1000) - Number(timestamp));
  return delta <= 300;
}
function base64Bytes(value) { return Uint8Array.from(atob(value), (character) => character.charCodeAt(0)); }
function randomToken(length = 24) { const values = crypto.getRandomValues(new Uint8Array(length)); return [...values].map((value) => value.toString(16).padStart(2, "0")).join(""); }
function validRequestId(value) { return typeof value === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(value); }
function validatePublicIp(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const octets = value.split(".").map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return false;
    const [a, b] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0));
  }
  if (!value.includes(":") || !/^[0-9a-f:]+$/i.test(value)) return false;
  const lower = value.toLowerCase();
  return lower !== "::" && lower !== "::1" && !lower.startsWith("fc") && !lower.startsWith("fd") && !lower.startsWith("fe8") && !lower.startsWith("fe9") && !lower.startsWith("fea") && !lower.startsWith("feb") && !lower.startsWith("ff") && !lower.startsWith("2001:db8:");
}
function validateOutId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{6,64}$/.test(value)) throw new TypeError(`${field} is invalid`);
}
function responseKeyHeaders(response, diagnostic) {
  const values = SIGNATURE_HEADERS.map((name) => response.headers.get(name));
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) throw new XiaodouProviderError("INCOMPLETE_RESPONSE_SIGNATURE", 502, "provider_response_signature", response.status, { ...diagnostic, signatureState: "incomplete" });
  return values;
}
async function readResponseBody(response) {
  let bytes;
  try { bytes = await readLimitedBytes(response.body, 64 * 1024); }
  catch (error) { if (error instanceof PayloadTooLargeError) throw new XiaodouProviderError("RESPONSE_TOO_LARGE", 502); throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE", 502); }
  return { bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
}

export class PayloadTooLargeError extends Error {}
export async function readLimitedBytes(stream, limit) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new PayloadTooLargeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

const SAFE_EXCEPTION_NAMES = new Set(["AbortError", "DOMException", "Error", "EvalError", "NetworkError", "RangeError", "ReferenceError", "SyntaxError", "TimeoutError", "TypeError", "URIError"]);
const SAFE_PROVIDER_CAUSE_CODES = new Set(["CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT", "EAI_AGAIN", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH", "ENOTFOUND", "ERR_INVALID_URL", "ERR_TLS_CERT_ALTNAME_INVALID", "ETIMEDOUT"]);

function safeErrorField(error, key, allowlist) {
  try {
    const value = error && typeof error === "object" ? error[key] : undefined;
    return typeof value === "string" && allowlist.has(value) ? value : "unknown";
  } catch { return "unknown"; }
}

function providerFetchUrlDiagnostics({ baseUrl, url, path, ownApiOrigin }) {
  let base, target, ownOrigin;
  try { base = new URL(baseUrl); } catch { /* The constructor normally rejects this before fetch. */ }
  try { target = new URL(url); } catch { /* Keep diagnostics non-throwing. */ }
  try {
    const parsed = new URL(ownApiOrigin);
    if (!parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === "/") ownOrigin = parsed;
  } catch { /* Missing or malformed trusted config means unknown. */ }

  const targetMatchesOwnApiOrigin = target && ownOrigin ? target.origin === ownOrigin.origin : "unknown";
  return {
    isHttps: target ? target.protocol === "https:" : "unknown",
    baseHasPathPrefix: base ? base.pathname !== "/" : "unknown",
    baseHasQueryOrFragment: base ? Boolean(base.search || base.hash) : "unknown",
    hasUnexpectedPort: target ? Boolean(target.port) : "unknown",
    paymentPathMatchesExpected: target && /^\/api\/open\/v1\/payments\/[^/]+$/.test(path) ? target.pathname === path : "unknown",
    targetMatchesOwnApiOrigin,
    // Exact API-origin equality is trusted as an own-domain target. For other
    // hostnames there is no configured zone suffix, so do not infer by suffix.
    targetUnderOwnDomainZone: target && ownOrigin && target.hostname === ownOrigin.hostname ? true : "unknown",
  };
}

export async function webhookSigningText({ "X-XD-Webhook-Event-Id": eventId, "X-XD-Webhook-Event-Type": eventType, "X-XD-Webhook-Timestamp": timestamp, "X-XD-Webhook-Nonce": nonce, "X-XD-Webhook-Key-Id": keyId, rawBody }) {
  for (const [name, value] of [["eventId", eventId], ["eventType", eventType], ["timestamp", timestamp], ["nonce", nonce], ["keyId", keyId]]) if (typeof value !== "string" || !value.length || /[\r\n]/.test(value)) throw new TypeError(`Webhook header is invalid: ${name}`);
  if (!EVENT_TYPES.has(eventType) || !/^\d{1,10}$/.test(timestamp) || !/^[\x21-\x7e]{16,64}$/.test(nonce) || !/^[\x21-\x7e]{1,128}$/.test(keyId)) throw new TypeError("Webhook headers are invalid");
  return ["XD-Webhook-v1", eventId, eventType, timestamp, nonce, keyId, await sha256(rawBody instanceof Uint8Array ? rawBody : encoder.encode(rawBody))].join("\n");
}

export class XiaodouClient {
  constructor({ baseUrl, ownApiOrigin, appId, keyId, privateKeyPem, platformPublicKeys, fetcher = fetch, now = () => Date.now(), monotonicNow = () => performance.now(), timeoutMs = 10_000, nonce = randomToken, environment = "", logger = (event) => console.warn(event) }) {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/" || base.port || base.href !== `${base.origin}/`) throw new TypeError("Xiaodou base URL must be a clean HTTPS origin");
    if (!/^xdop_[A-Za-z0-9]{16}$/.test(appId) || !/^mkid_[0-9a-f]{16}$/.test(keyId) || !platformPublicKeys || typeof platformPublicKeys !== "object") throw new TypeError("Xiaodou credential configuration is invalid");
    this.baseUrl = base.href.replace(/\/$/, "");
    this.ownApiOrigin = ownApiOrigin;
    this.appId = appId;
    this.keyId = keyId;
    this.privateKeyPem = privateKeyPem;
    this.platformPublicKeys = platformPublicKeys;
    this.fetcher = fetcher;
    this.now = now;
    this.monotonicNow = monotonicNow;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError("Invalid request timeout");
    this.timeoutMs = timeoutMs;
    this.nonce = nonce;
    this.environment = environment;
    this.logger = logger;
  }
  async #privateKey() { return crypto.subtle.importKey("pkcs8", pemBytes(this.privateKeyPem, "PRIVATE KEY"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]); }
  async #verify(keyId, signature, text) {
    const pem = this.platformPublicKeys[keyId];
    if (!pem) throw new XiaodouProviderError("UNKNOWN_PLATFORM_KEY", 401, "provider_response_signature");
    const key = await crypto.subtle.importKey("spki", pemBytes(pem, "PUBLIC KEY"), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(signature)) return false;
    let signatureBytes;
    try { signatureBytes = base64Bytes(signature); } catch { return false; }
    if (signatureBytes.byteLength !== Math.ceil(key.algorithm.modulusLength / 8)) return false;
    return await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signatureBytes, encoder.encode(text));
  }
  async verifyWebhook(headers, rawBody) {
    const values = {
      "X-XD-Webhook-Event-Id": readWebhookHeader(headers, "X-XD-Webhook-Event-Id"),
      "X-XD-Webhook-Event-Type": readWebhookHeader(headers, "X-XD-Webhook-Event-Type"),
      "X-XD-Webhook-Timestamp": readWebhookHeader(headers, "X-XD-Webhook-Timestamp"),
      "X-XD-Webhook-Nonce": readWebhookHeader(headers, "X-XD-Webhook-Nonce"),
      "X-XD-Webhook-Key-Id": readWebhookHeader(headers, "X-XD-Webhook-Key-Id"),
    };
    if (!timestampIsFresh(values["X-XD-Webhook-Timestamp"], this.now())) throw new XiaodouProviderError("STALE_WEBHOOK", 401);
    let text;
    try { text = await webhookSigningText({ ...values, rawBody }); }
    catch (error) { if (error instanceof TypeError) throw new XiaodouProviderError("INVALID_WEBHOOK_HEADERS", 401); throw error; }
    const signature = readWebhookHeader(headers, "X-XD-Webhook-Signature");
    if (!await this.#verify(values["X-XD-Webhook-Key-Id"], signature, text)) throw new XiaodouProviderError("INVALID_WEBHOOK_SIGNATURE", 401);
    return { eventId: values["X-XD-Webhook-Event-Id"], eventType: values["X-XD-Webhook-Event-Type"], bodySha256: await sha256(rawBody) };
  }
  async #request(method, path, { requestId, body, query = "", contentType = "" } = {}) {
    const id = requestId || randomToken(16);
    if (!validRequestId(id)) throw new TypeError("Xiaodou request id is invalid");
    const timestamp = String(Math.floor(this.now() / 1000));
    const nonce = this.nonce();
    if (!/^[\x21-\x7e]{16,64}$/.test(nonce)) throw new TypeError("Xiaodou nonce is invalid");
    const rawBody = body === undefined ? "" : body;
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
    const pathName = new URL(url).pathname;
    let signature;
    try {
      const signatureText = await canonicalRequest({ method, path: pathName, query, timestamp, nonce, appId: this.appId, keyId: this.keyId, requestId: id, contentType, rawBody });
      const privateKey = await this.#privateKey();
      signature = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, encoder.encode(signatureText)))));
    } catch {
      throw new XiaodouProviderError("PROVIDER_CONFIG_ERROR", 503, "provider_request_signing");
    }
    const headers = { "X-XD-App-Id": this.appId, "X-XD-Timestamp": timestamp, "X-XD-Nonce": nonce, "X-XD-Key-Id": this.keyId, "X-XD-Request-Id": id, "X-XD-Sign": signature };
    if (contentType) headers["Content-Type"] = contentType;
    let response;
    const fetchStartedAt = this.monotonicNow();
    // Workers' global fetch rejects a client instance as its `this` receiver.
    const fetcher = this.fetcher;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try { response = await fetcher(url, { method, headers, signal: controller.signal, redirect: "manual", ...(body !== undefined ? { body } : {}) }); }
    catch (error) {
      if (this.environment === "staging") {
        try {
          let cause;
          try { cause = error && typeof error === "object" ? error.cause : undefined; } catch { cause = undefined; }
          const exceptionName = safeErrorField(error, "name", SAFE_EXCEPTION_NAMES);
          const causeName = safeErrorField(cause, "name", SAFE_EXCEPTION_NAMES);
          let causeCode = "unknown";
          try {
            const code = cause && typeof cause === "object" ? cause.code : undefined;
            if (typeof code === "string" && SAFE_PROVIDER_CAUSE_CODES.has(code)) causeCode = code;
          } catch { /* Ignore malformed cause objects. */ }
          const elapsed = this.monotonicNow() - fetchStartedAt;
          const elapsedMs = Number.isFinite(elapsed) ? Math.round(Math.max(0, elapsed) * 100) / 100 : "unknown";
          this.logger({
            event: "xiaodou_provider_fetch_failed",
            requestId: id,
            stage: "provider_fetch",
            elapsedMs,
            exceptionName,
            causeName,
            causeCode,
            category: exceptionName === "AbortError" || causeName === "AbortError" ? "aborted" : "fetch_rejected",
            ...providerFetchUrlDiagnostics({ baseUrl: this.baseUrl, url, path, ownApiOrigin: this.ownApiOrigin }),
          });
        } catch { /* Diagnostics must never alter provider error handling. */ }
      }
      throw new XiaodouProviderError("NETWORK_UNCERTAIN", 503, "provider_fetch");
    } finally { clearTimeout(timer); }
    let result;
    try { result = await readResponseBody(response); } catch (error) { if (error instanceof XiaodouProviderError) throw error; throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE", 502); }
    const responseDiagnostic = describeProviderResponse(response, result.text);
    const signatureHeaders = responseKeyHeaders(response, responseDiagnostic);
    if (signatureHeaders) {
      // Complete headers are not trusted until every signature check succeeds,
      // including non-2xx responses. Invalid metadata remains fail-closed.
      responseDiagnostic.signatureState = "invalid";
      const [responseSign, responseKeyId, responseTimestamp, responseNonce] = signatureHeaders;
      if (!timestampIsFresh(responseTimestamp, this.now())) throw new XiaodouProviderError("STALE_PROVIDER_RESPONSE", 502, "provider_response_signature", response.status, responseDiagnostic);
      const responseRequestId = response.headers.get("X-XD-Request-Id");
      if (!responseRequestId) throw new XiaodouProviderError("PROVIDER_REQUEST_ID_MISSING", 502, "provider_response_signature", response.status, responseDiagnostic);
      if (responseRequestId !== id) throw new XiaodouProviderError("PROVIDER_REQUEST_ID_MISMATCH", 502, "provider_response_signature", response.status, responseDiagnostic);
      const canonical = ["XD-Response-v1", String(response.status), normalizeContentType(response.headers.get("Content-Type")), responseRequestId, responseTimestamp, responseNonce, responseKeyId, await sha256(result.bytes)].join("\n");
      let verified = false;
      try { verified = await this.#verify(responseKeyId, responseSign, canonical); } catch { /* Do not surface crypto implementation details. */ }
      if (!verified) throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE_SIGNATURE", 502, "provider_response_signature", response.status, responseDiagnostic);
      responseDiagnostic.signatureState = "verified";
    } else if (response.ok) throw new XiaodouProviderError("UNSIGNED_PROVIDER_SUCCESS", 502, "provider_response_signature", response.status, responseDiagnostic);
    if (!response.ok) {
      let code = "PROVIDER_REJECTED";
      try { const parsed = JSON.parse(result.text); if (typeof parsed.code === "string" && /^[A-Z0-9_]{1,80}$/.test(parsed.code)) code = parsed.code; } catch { /* Deliberately ignore provider response text. */ }
      throw new XiaodouProviderError(code, response.status >= 500 ? 502 : 409, "provider_http_response", response.status, responseDiagnostic);
    }
    let data;
    try { data = JSON.parse(result.text); } catch { throw new XiaodouProviderError("INVALID_PROVIDER_JSON", 502, "provider_response", response.status); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE", 502, "provider_response", response.status);
    return data;
  }
  async createPayment(input, options = {}) {
    validateOutId(input.outTradeNo, "outTradeNo");
    if (!Number.isSafeInteger(input.amountFen) || input.amountFen < 1 || input.currency !== "CNY" || !["ALIPAY_H5", "WECHAT_H5"].includes(input.channel) || !validatePublicIp(input.payerClientIp) || typeof input.subject !== "string" || !input.subject || input.subject.length > 128) throw new TypeError("Payment request is invalid");
    if (input.returnUrl) { const target = new URL(input.returnUrl); if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || input.returnUrl.length > 512) throw new TypeError("Payment return URL is invalid"); }
    // Preserve seller-borne prices; BUYER surcharges need separate pricing approval.
    if (input.feeBearer !== undefined && input.feeBearer !== "SELLER") throw new TypeError("Unsupported buyer fee contract");
    if (input.tradeScope !== undefined && !["CARD_VIRTUAL", "PHYSICAL_FACE_TO_FACE"].includes(input.tradeScope)) throw new TypeError("Invalid declared trade scope");
    const body = JSON.stringify({ outTradeNo: input.outTradeNo, channel: input.channel, amountFen: input.amountFen, currency: "CNY", subject: input.subject, payerClientIp: input.payerClientIp, ...(input.tradeScope ? { tradeScope: input.tradeScope } : {}), ...(input.description ? { description: input.description } : {}), ...(input.attach ? { attach: input.attach } : {}), ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}) });
    return this.#request("POST", "/api/open/v1/payments", { ...options, body, contentType: "application/json" });
  }
  async queryPayment(outTradeNo, options = {}) { validateOutId(outTradeNo, "outTradeNo"); return this.#request("GET", `/api/open/v1/payments/${encodeURIComponent(outTradeNo)}`, options); }
  async getSettlementAccounts(options = {}) { return this.#request("GET", "/api/open/v1/settlement/accounts", options); }
  async relaunchPayment(outTradeNo, options = {}) { validateOutId(outTradeNo, "outTradeNo"); return this.#request("POST", `/api/open/v1/payments/${encodeURIComponent(outTradeNo)}/attempts`, { ...options, body: "", contentType: "application/json" }); }
  async closePayment(outTradeNo, options = {}) { validateOutId(outTradeNo, "outTradeNo"); return this.#request("POST", `/api/open/v1/payments/${encodeURIComponent(outTradeNo)}/close`, { ...options, body: "", contentType: "application/json" }); }
  async createRefund(input, options = {}) {
    validateOutId(input.outTradeNo, "outTradeNo"); validateOutId(input.outRefundNo, "outRefundNo");
    if (!Number.isSafeInteger(input.refundAmountFen) || input.refundAmountFen < 1 || (input.reason && input.reason.length > 256)) throw new TypeError("Refund request is invalid");
    return this.#request("POST", "/api/open/v1/refunds", { ...options, body: JSON.stringify({ outTradeNo: input.outTradeNo, outRefundNo: input.outRefundNo, refundAmountFen: input.refundAmountFen, ...(input.reason ? { reason: input.reason } : {}) }), contentType: "application/json" });
  }
  async queryRefund(outRefundNo, options = {}) { validateOutId(outRefundNo, "outRefundNo"); return this.#request("GET", `/api/open/v1/refunds/${encodeURIComponent(outRefundNo)}`, options); }
}
