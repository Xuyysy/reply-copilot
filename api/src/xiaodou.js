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

export class XiaodouProviderError extends Error {
  constructor(code, status = 502, stage = "provider_response", upstreamHttpStatus = null) {
    super("小豆支付暂时无法处理请求。");
    this.name = "XiaodouProviderError";
    this.code = code;
    this.status = status;
    this.stage = stage;
    this.upstreamHttpStatus = upstreamHttpStatus;
  }
}

export function xiaodouWebhookIsEnabled(env) {
  return env?.PAYMENT_PROVIDER === "xiaodou" && env?.XIAODOU_WEBHOOKS_ENABLED === "1";
}

export function xiaodouPaymentOrdersAreEnabled(env) {
  return env?.PAYMENT_PROVIDER === "xiaodou" && env?.PAYMENTS_ENABLED === "1";
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
function responseKeyHeaders(response) {
  const values = SIGNATURE_HEADERS.map((name) => response.headers.get(name));
  if (values.every((value) => value === null)) return null;
  if (values.some((value) => value === null)) throw new XiaodouProviderError("INCOMPLETE_RESPONSE_SIGNATURE", 502, "provider_response_signature", response.status);
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

export function webhookSigningText({ "X-XD-Webhook-Event-Id": eventId, "X-XD-Webhook-Event-Type": eventType, "X-XD-Webhook-Timestamp": timestamp, "X-XD-Webhook-Nonce": nonce, "X-XD-Webhook-Key-Id": keyId, rawBody }) {
  for (const [name, value] of [["eventId", eventId], ["eventType", eventType], ["timestamp", timestamp], ["nonce", nonce], ["keyId", keyId]]) if (typeof value !== "string" || !value.length || /[\r\n]/.test(value)) throw new TypeError(`Webhook header is invalid: ${name}`);
  if (!EVENT_TYPES.has(eventType) || !/^\d{1,10}$/.test(timestamp) || !/^[\x21-\x7e]{16,64}$/.test(nonce) || !/^[\x21-\x7e]{1,128}$/.test(keyId)) throw new TypeError("Webhook headers are invalid");
  return ["XD-Webhook-v1", eventId, eventType, timestamp, nonce, keyId, hex(rawBody instanceof Uint8Array ? rawBody : encoder.encode(rawBody))].join("\n");
}

export class XiaodouClient {
  constructor({ baseUrl, appId, keyId, privateKeyPem, platformPublicKeys, fetcher = fetch, now = () => Date.now(), nonce = randomToken }) {
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new TypeError("Xiaodou base URL must be a clean HTTPS origin");
    if (!/^xdop_[A-Za-z0-9]{16}$/.test(appId) || !/^mkid_[0-9a-f]{16}$/.test(keyId) || !platformPublicKeys || typeof platformPublicKeys !== "object") throw new TypeError("Xiaodou credential configuration is invalid");
    this.baseUrl = base.href.replace(/\/$/, "");
    this.appId = appId;
    this.keyId = keyId;
    this.privateKeyPem = privateKeyPem;
    this.platformPublicKeys = platformPublicKeys;
    this.fetcher = fetcher;
    this.now = now;
    this.nonce = nonce;
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
    try { text = webhookSigningText({ ...values, rawBody }); }
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
    try { response = await this.fetcher(url, { method, headers, ...(body !== undefined ? { body } : {}) }); }
    catch { throw new XiaodouProviderError("NETWORK_UNCERTAIN", 503, "provider_fetch"); }
    let result;
    try { result = await readResponseBody(response); } catch (error) { if (error instanceof XiaodouProviderError) throw error; throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE", 502); }
    const signatureHeaders = responseKeyHeaders(response);
    if (signatureHeaders) {
      const [responseSign, responseKeyId, responseTimestamp, responseNonce] = signatureHeaders;
      if (!timestampIsFresh(responseTimestamp, this.now())) throw new XiaodouProviderError("STALE_PROVIDER_RESPONSE", 502, "provider_response_signature", response.status);
      const responseRequestId = response.headers.get("X-XD-Request-Id");
      if (!responseRequestId) throw new XiaodouProviderError("PROVIDER_REQUEST_ID_MISSING", 502, "provider_response_signature", response.status);
      if (responseRequestId !== id) throw new XiaodouProviderError("PROVIDER_REQUEST_ID_MISMATCH", 502, "provider_response_signature", response.status);
      const canonical = ["XD-Response-v1", String(response.status), normalizeContentType(response.headers.get("Content-Type")), responseRequestId, responseTimestamp, responseNonce, responseKeyId, await sha256(result.bytes)].join("\n");
      let verified = false;
      try { verified = await this.#verify(responseKeyId, responseSign, canonical); } catch { /* Do not surface crypto implementation details. */ }
      if (!verified) throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE_SIGNATURE", 502, "provider_response_signature", response.status);
    } else if (response.ok) throw new XiaodouProviderError("UNSIGNED_PROVIDER_SUCCESS", 502, "provider_response_signature", response.status);
    if (!response.ok) {
      let code = "PROVIDER_REJECTED";
      try { const parsed = JSON.parse(result.text); if (typeof parsed.code === "string" && /^[A-Z0-9_]{1,80}$/.test(parsed.code)) code = parsed.code; } catch { /* Deliberately ignore provider response text. */ }
      throw new XiaodouProviderError(code, response.status >= 500 ? 502 : 409, "provider_http_response", response.status);
    }
    let data;
    try { data = JSON.parse(result.text); } catch { throw new XiaodouProviderError("INVALID_PROVIDER_JSON", 502, "provider_response", response.status); }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new XiaodouProviderError("INVALID_PROVIDER_RESPONSE", 502, "provider_response", response.status);
    return data;
  }
  async createPayment(input, options = {}) {
    validateOutId(input.outTradeNo, "outTradeNo");
    if (!Number.isSafeInteger(input.amountFen) || input.amountFen < 1 || input.currency !== "CNY" || input.channel !== "ALIPAY_H5" || !validatePublicIp(input.payerClientIp) || typeof input.subject !== "string" || !input.subject || input.subject.length > 128) throw new TypeError("Payment request is invalid");
    if (input.returnUrl) { const target = new URL(input.returnUrl); if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || input.returnUrl.length > 512) throw new TypeError("Payment return URL is invalid"); }
    const body = JSON.stringify({ outTradeNo: input.outTradeNo, channel: input.channel, amountFen: input.amountFen, currency: "CNY", subject: input.subject, payerClientIp: input.payerClientIp, ...(input.description ? { description: input.description } : {}), ...(input.attach ? { attach: input.attach } : {}), ...(input.returnUrl ? { returnUrl: input.returnUrl } : {}) });
    return this.#request("POST", "/api/open/v1/payments", { ...options, body, contentType: "application/json" });
  }
  async queryPayment(outTradeNo, options = {}) { validateOutId(outTradeNo, "outTradeNo"); return this.#request("GET", `/api/open/v1/payments/${encodeURIComponent(outTradeNo)}`, options); }
  async relaunchPayment(outTradeNo, options = {}) { validateOutId(outTradeNo, "outTradeNo"); return this.#request("POST", `/api/open/v1/payments/${encodeURIComponent(outTradeNo)}/attempts`, { ...options, body: "", contentType: "application/json" }); }
  async closePayment(outTradeNo, options = {}) { validateOutId(outTradeNo, "outTradeNo"); return this.#request("POST", `/api/open/v1/payments/${encodeURIComponent(outTradeNo)}/close`, { ...options, body: "", contentType: "application/json" }); }
  async createRefund(input, options = {}) {
    validateOutId(input.outTradeNo, "outTradeNo"); validateOutId(input.outRefundNo, "outRefundNo");
    if (!Number.isSafeInteger(input.refundAmountFen) || input.refundAmountFen < 1 || (input.reason && input.reason.length > 256)) throw new TypeError("Refund request is invalid");
    return this.#request("POST", "/api/open/v1/refunds", { ...options, body: JSON.stringify({ outTradeNo: input.outTradeNo, outRefundNo: input.outRefundNo, refundAmountFen: input.refundAmountFen, ...(input.reason ? { reason: input.reason } : {}) }), contentType: "application/json" });
  }
  async queryRefund(outRefundNo, options = {}) { validateOutId(outRefundNo, "outRefundNo"); return this.#request("GET", `/api/open/v1/refunds/${encodeURIComponent(outRefundNo)}`, options); }
}
