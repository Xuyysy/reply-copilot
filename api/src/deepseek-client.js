export class DeepSeekClientError extends Error {
  constructor(code) {
    super(`DeepSeek request failed (${code})`);
    this.name = "DeepSeekClientError";
    this.code = code;
  }
}

function validRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function validateReplyOutput(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Model output is not valid JSON");
  }
  const replies = value && typeof value === "object" && !Array.isArray(value) ? value.replies : null;
  const candidates = replies && [replies.natural, replies.light_humor, replies.thoughtful];
  if (!candidates || candidates.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error("Model output is missing a reply candidate");
  }
  const normalized = candidates.map((item) => item.trim().normalize("NFKC").toLocaleLowerCase());
  if (new Set(normalized).size !== 3) throw new Error("Model reply candidates must be distinct");
  return value;
}

export function validateDeepSeekResult(result) {
  if (result?.finishReason !== "stop") throw new Error("Model output was not completed");
  if (typeof result.raw !== "string" || !result.raw.trim()) throw new Error("Model output is empty");
  return validateReplyOutput(result.raw);
}

export async function requestDeepSeek({
  apiKey,
  system,
  user,
  inputRateUsdPerMillion,
  outputRateUsdPerMillion,
  fetchImpl = fetch,
  timeoutMs = 25_000,
}) {
  if (!apiKey || !validRate(inputRateUsdPerMillion) || !validRate(outputRateUsdPerMillion)) {
    throw new DeepSeekClientError("not_configured");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let upstream;
  try {
    upstream = await fetchImpl("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        thinking: { type: "disabled" },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    throw new DeepSeekClientError(controller.signal.aborted || error?.name === "AbortError" ? "timeout" : "transport_error");
  }

  try {
    if (!upstream.ok) throw new DeepSeekClientError(upstream.status === 429 ? "rate_limited" : "http_error");
    let data;
    try {
      data = await upstream.json();
    } catch {
      throw new DeepSeekClientError("invalid_response");
    }
    const choice = data?.choices?.[0];
    const inputTokens = data?.usage?.prompt_tokens;
    const outputTokens = data?.usage?.completion_tokens;
    if (!choice || typeof choice.finish_reason !== "string" || typeof data?.model !== "string") {
      throw new DeepSeekClientError("invalid_response");
    }
    if (![inputTokens, outputTokens].every((item) => Number.isSafeInteger(item) && item >= 0)) {
      throw new DeepSeekClientError("invalid_usage");
    }
    const raw = typeof choice.message?.content === "string" ? choice.message.content : "";
    if (raw.length > 20_000) throw new DeepSeekClientError("invalid_response");
    // Charge all prompt tokens at the peak cache-miss price. This intentionally
    // overestimates cache hits, keeping the Staging budget conservative.
    const costMicroUsd = Math.ceil(inputTokens * inputRateUsdPerMillion + outputTokens * outputRateUsdPerMillion);
    if (!Number.isSafeInteger(costMicroUsd)) throw new DeepSeekClientError("invalid_usage");
    return {
      raw,
      finishReason: choice.finish_reason,
      usage: { model: data.model, inputTokens, outputTokens, costMicroUsd },
    };
  } finally {
    clearTimeout(timer);
  }
}
