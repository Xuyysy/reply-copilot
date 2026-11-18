import { parseAIOutput } from "../../utils/output-parser.js";

const BUILTIN_HOSTS = {
  deepseek: new Set(["api.deepseek.com"]),
  gemini: new Set(["generativelanguage.googleapis.com"]),
};

export class ModelProviderError extends Error {
  /** @param {string} code @param {number|null} [status] @param {number|null} [estimatedCostMicroUsd] @param {{model:string,inputTokens:number,outputTokens:number,costMicroUsd:number,usageQuality:string}|null} [usage] */
  constructor(code, status = null, estimatedCostMicroUsd = null, usage = null) {
    super(`AI provider request failed (${code})`);
    this.name = "ModelProviderError";
    this.code = code;
    this.status = status;
    this.estimatedCostMicroUsd = estimatedCostMicroUsd;
    this.usage = usage || (Number.isSafeInteger(estimatedCostMicroUsd) && estimatedCostMicroUsd > 0
      ? { model: "unknown-estimated", inputTokens: 0, outputTokens: 0, costMicroUsd: estimatedCostMicroUsd, usageQuality: "estimated" }
      : null);
  }
}

export function validateModelOutput(raw) {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 20_000) throw new Error("invalid_output");
  // The website and extension share this exact parser contract. Parsing and
  // serializing also strips markdown fences and normalizes legacy aliases only
  // where the existing parser explicitly permits them.
  const parsed = parseAIOutput(raw.trim());
  const replies = [parsed.replies.natural, parsed.replies.light_humor, parsed.replies.thoughtful]
    .map((value) => value.normalize("NFKC").trim().toLocaleLowerCase());
  if (new Set(replies).size !== 3) throw new Error("duplicate_replies");
  return parsed;
}

/** Keep the optional score absent on the wire for released 0.3.1 clients.
 * Internally the parser still normalizes absence to null. Never strip any
 * required field or an invalid score to make an invalid response pass. */
function serializeValidatedModelOutput(parsed) {
  if (parsed.score === null) {
    const { score, ...compatible } = parsed;
    return JSON.stringify(compatible);
  }
  return JSON.stringify(parsed);
}

// Public entrypoint stays independently validating when given arbitrary raw
// text (replay, legacy provider and other callers).
export function serializeModelOutput(raw) {
  return serializeValidatedModelOutput(validateModelOutput(raw));
}

export function buildChatCompletionRequest(config, system, user, { testMode = false } = {}) {
  const body = {
    model: config.modelId,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    max_tokens: testMode ? Math.min(32, config.maxOutputTokens) : config.maxOutputTokens,
  };
  if (config.provider === "deepseek") {
    body.response_format = { type: "json_object" };
    body.thinking = { type: "disabled" };
  } else if (config.provider === "qwen") {
    if (config.options?.jsonMode !== false) body.response_format = { type: "json_object" };
    if (config.options?.thinkingMode === "disabled") body.enable_thinking = false;
    if (config.options?.thinkingMode === "enabled") body.enable_thinking = true;
  }
  // Gemini's OpenAI-compatible Chat Completions docs don't document the
  // response_format field for this route. Keep it prompt-only and validate
  // strictly; never send DeepSeek-only or guessed vendor fields.
  return body;
}

function isIpv4(address) {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b, c] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168)) || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
}

function ipv6Bytes(address) {
  const value = address.toLowerCase().split("%")[0];
  if (value.includes(".")) {
    const split = value.lastIndexOf(":");
    const v4 = value.slice(split + 1);
    if (!isIpv4(v4)) return null;
    const octets = v4.split(".").map(Number);
    return ipv6Bytes(`${value.slice(0, split)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`);
  }
  if (!/^[0-9a-f:]+$/.test(value) || value.includes(":::")) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.flatMap((group) => { const n = Number.parseInt(group, 16); return [n >> 8, n & 255]; });
}

export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  if (address.includes(".")) return isIpv4(address);
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const first = bytes[0];
  // Only global unicast 2000::/3 is accepted. Exclude documentation,
  // benchmarking, ORCHID, 6to4, mapped, unique-local, link-local and multicast.
  const globalUnicast = (first & 0xe0) === 0x20;
  const doc = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8;
  const benchmark = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x02;
  const sixToFour = bytes[0] === 0x20 && bytes[1] === 0x02;
  return globalUnicast && !doc && !benchmark && !sixToFour;
}

function parseBaseUrl(config) {
  if (!config || !["deepseek", "qwen", "gemini", "openai_compatible"].includes(config.provider) || config.protocol !== "openai_chat") throw new ModelProviderError("unsupported_protocol");
  let url;
  try { url = new URL(config.baseUrl); } catch { throw new ModelProviderError("invalid_endpoint"); }
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" || url.search || url.hash) throw new ModelProviderError("unsafe_endpoint");
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) throw new ModelProviderError("unsafe_endpoint");
  // IP literals are rejected, including IPv6. Runtime DNS validation below is
  // required for custom hosts before every credential-bearing request.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":")) throw new ModelProviderError("unsafe_endpoint");
  const path = url.pathname.replace(/\/+$/, "");
  if (config.provider === "deepseek" && (!BUILTIN_HOSTS.deepseek.has(host) || !["", "/v1"].includes(path))) throw new ModelProviderError("provider_endpoint_mismatch");
  if (config.provider === "gemini" && (!BUILTIN_HOSTS.gemini.has(host) || !["/v1beta/openai", "/v1beta/openai/v1"].includes(path))) throw new ModelProviderError("provider_endpoint_mismatch");
  if (config.provider === "qwen" && !(host === "dashscope.aliyuncs.com" || host === "dashscope-intl.aliyuncs.com" || host.endsWith(".maas.aliyuncs.com"))) throw new ModelProviderError("provider_endpoint_mismatch");
  if (config.provider === "qwen" && !path.endsWith("/compatible-mode/v1")) throw new ModelProviderError("provider_endpoint_mismatch");
  if (config.provider === "openai_compatible" && !path) throw new ModelProviderError("invalid_endpoint");
  return { url, host, path };
}

async function resolveWithDoh(host, fetchImpl = fetch) {
  const addresses = new Set();
  let current = host;
  const seen = new Set();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    for (let depth = 0; depth < 6; depth += 1) {
      if (seen.has(current)) throw new ModelProviderError("dns_invalid");
      seen.add(current);
      let foundCname = null;
      let foundAddress = false;
      // Wait for and inspect BOTH families. No DNS caching or early acceptance:
      // a private AAAA answer must reject even when the A answer is public.
      const responses = await Promise.all(["A", "AAAA"].map(async (type) => {
        const response = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(current)}&type=${type}`, { headers: { accept: "application/dns-json" }, redirect: "manual", signal: controller.signal });
        if (!response.ok || response.status >= 300) throw new ModelProviderError("dns_unavailable");
        return response.json();
      }));
      for (const body of responses) {
        if (body.Status !== 0) continue;
        for (const answer of body.Answer || []) {
          if (answer.type === 5 && typeof answer.data === "string") foundCname = answer.data.replace(/\.$/, "").toLowerCase();
          if (answer.type === 1 || answer.type === 28) { addresses.add(answer.data); foundAddress = true; }
        }
      }
      if (!foundCname || foundAddress) return [...addresses];
      current = foundCname;
    }
    throw new ModelProviderError("dns_invalid");
  } catch (error) {
    if (error instanceof ModelProviderError) throw error;
    throw new ModelProviderError(controller.signal.aborted ? "dns_timeout" : "dns_unavailable");
  } finally {
    // If either parallel lookup fails, stop its sibling as well.
    controller.abort();
    clearTimeout(timer);
  }
}

export async function validateProviderEndpoint(config, resolver = resolveWithDoh) {
  const parsed = parseBaseUrl(config);
  const addresses = [...new Set(await resolver(parsed.host))].sort();
  if (!Array.isArray(addresses) || !addresses.length || addresses.some((address) => !isPublicAddress(address))) throw new ModelProviderError("unsafe_endpoint");
  if (config.provider === "openai_compatible" && Array.isArray(config.endpointAddresses) && config.endpointAddresses.length
    && JSON.stringify(addresses) !== JSON.stringify([...config.endpointAddresses].sort())) throw new ModelProviderError("dns_changed");
  return addresses;
}

export function providerRequestUrl(config) {
  const { url, path } = parseBaseUrl(config);
  const prefix = config.provider === "gemini" ? `${path}/chat/completions` : `${path}/chat/completions`;
  url.pathname = prefix || "/chat/completions";
  return url.toString();
}

export function classifyProviderFailure(error) {
  if (error?.status === 302 || error?.status === 301 || error?.status === 307 || error?.status === 308) return "redirect_blocked";
  if (error?.status === 401 || error?.status === 403) return "authentication_error";
  if (error?.status === 429) return "rate_limited";
  if (error?.status >= 500) return "provider_unavailable";
  return error?.code || "provider_error";
}

export async function requestConfiguredModel({ config, apiKey, system, user, inputRateMicroUsdPerMillion, outputRateMicroUsdPerMillion, reservedCostMicroUsd = 0, testMode = false, validateOutput = true, fetchImpl = fetch, validateEndpoint = validateProviderEndpoint, performanceTrace = null }) {
  if (typeof apiKey !== "string" || apiKey.length < 8 || apiKey.length > 512 || !Number.isSafeInteger(inputRateMicroUsdPerMillion) || inputRateMicroUsdPerMillion <= 0 || !Number.isSafeInteger(outputRateMicroUsdPerMillion) || outputRateMicroUsdPerMillion <= 0) throw new ModelProviderError("model_not_configured");
  if (performanceTrace) await performanceTrace.measure("dns", () => validateEndpoint(config));
  else await validateEndpoint(config);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let upstream;
  const modelStarted = performanceTrace?.enabled ? performance.now() : null;
  try {
    upstream = await fetchImpl(providerRequestUrl(config), {
      method: "POST", redirect: "manual", signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(buildChatCompletionRequest(config, system, user, { testMode })),
    });
  } catch (error) {
    clearTimeout(timer);
    if (modelStarted !== null) performanceTrace.addDurations({model:performance.now()-modelStarted});
    throw new ModelProviderError(controller.signal.aborted ? "timeout" : "transport_error", null, reservedCostMicroUsd);
  }
  try {
    if (!upstream.ok) throw new ModelProviderError(classifyProviderFailure({ status: upstream.status }), upstream.status, reservedCostMicroUsd);
    let data;
    try { data = await upstream.json(); } catch { throw new ModelProviderError("invalid_response", upstream.status, reservedCostMicroUsd); }
    const choice = data?.choices?.[0];
    if (!choice || typeof choice.finish_reason !== "string" || typeof choice.message?.content !== "string" || choice.finish_reason !== "stop") throw new ModelProviderError(choice?.finish_reason === "length" ? "truncated_output" : "invalid_response", upstream.status, reservedCostMicroUsd);
    const promptTokens = data?.usage?.prompt_tokens;
    const completionTokens = data?.usage?.completion_tokens;
    if (![promptTokens, completionTokens].every((value) => Number.isSafeInteger(value) && value >= 0)) throw new ModelProviderError("usage_unavailable", upstream.status, reservedCostMicroUsd);
    const costMicroUsd = Math.ceil(promptTokens * inputRateMicroUsdPerMillion / 1_000_000 + completionTokens * outputRateMicroUsdPerMillion / 1_000_000);
    const usage = { model: config.modelId, inputTokens: promptTokens, outputTokens: completionTokens, costMicroUsd, usageQuality: "verified" };
    if (!Number.isSafeInteger(costMicroUsd) || costMicroUsd > reservedCostMicroUsd) throw new ModelProviderError("cost_reservation_exceeded", upstream.status, reservedCostMicroUsd, { ...usage, costMicroUsd: reservedCostMicroUsd, usageQuality: "estimated" });
    let parsed = null;
    if (validateOutput) {
      try { parsed = validateModelOutput(choice.message.content); }
      catch { throw new ModelProviderError("invalid_output", upstream.status, reservedCostMicroUsd, usage); }
    }
    // The parsed value above is already validated. Serializing that exact value
    // avoids parsing and NFKC-normalizing the same provider text a second time.
    return { raw: parsed ? serializeValidatedModelOutput(parsed) : "", content: choice.message.content, finishReason: choice.finish_reason, httpStatus: upstream.status, usage };
  } finally {
    if (modelStarted !== null) performanceTrace.addDurations({model:performance.now()-modelStarted});
    clearTimeout(timer);
  }
}
