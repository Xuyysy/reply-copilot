import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, takeRate } from "./auth";
import { jsonBody, nowMs, sha256 } from "./security";
import { response } from "./http";
import { finishGeneration, reserveGeneration } from "./quota";
import { buildPrompts } from "../../prompts/prompt-builder.js";

function normalizeInput(body: Record<string, unknown>) {
  const requestId = typeof body.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.requestId) ? body.requestId : "";
  const post = body.post && typeof body.post === "object" && !Array.isArray(body.post) ? body.post as Record<string,unknown> : {};
  const text = typeof post.text === "string" ? post.text.trim() : "";
  const url = typeof post.url === "string" ? post.url : "";
  if (!requestId || !text || text.length > 12_000 || (url && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(url))) throw new ApiFailure(400, "INVALID_REQUEST", "帖子或请求标识无效。");
  const profile = body.voiceProfile && typeof body.voiceProfile === "object" && !Array.isArray(body.voiceProfile) ? body.voiceProfile : undefined;
  const history = Array.isArray(body.recentHistory) ? body.recentHistory.slice(0, 20) : [];
  const replyStyle = ["natural-friendly", "short", "balanced"].includes(String(body.replyStyle)) ? String(body.replyStyle) : "natural-friendly";
  return { requestId, post: { text, url }, profile, history, replyStyle };
}
async function provider(env: Env, system: string, user: string): Promise<string> {
  if (env.AI_MOCK === "1") {
    if (env.ENVIRONMENT !== "development" || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(env.WEB_ORIGIN)) throw new ApiFailure(503, "SERVER_UNAVAILABLE", "生产环境不能使用模拟 AI。");
    return JSON.stringify({ recommendation: "reply", defaultStyle: "natural", language: "en", replies: { natural: "That detail really stayed with me. Thanks for putting it into words.", light_humor: "Well, this was more relatable than my inbox needed today.", thoughtful: "The quiet consistency behind this is easy to miss, but it matters." }, reason: "A conversational response fits the post.", quoteCandidate: null });
  }
  if (!env.DEEPSEEK_API_KEY) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "托管 AI 尚未配置。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "deepseek-flash", messages: [{role:"system",content:system},{role:"user",content:user}], response_format: {type:"json_object"}, max_tokens: 1200, thinking: {type:"disabled"} }), signal: controller.signal });
    if (!upstream.ok) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用。");
    const data = await upstream.json() as { choices?: Array<{message?:{content?:string}}> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw || raw.length > 20_000) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务返回内容无效。");
    return raw;
  } catch { throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。"); }
  finally { clearTimeout(timer); }
}
export async function generate(request: Request, env: Env): Promise<Response> {
  const { session } = await sessionFor(request, env);
  if (session.kind !== "extension") throw new ApiFailure(403, "FORBIDDEN", "请在已绑定的插件中生成回复。");
  const body = await jsonBody(request, 24_000);
  const input = normalizeInput(body);
  if (!await takeRate(env, `ai-user:${session.user_id}`, 40, 60_000, nowMs())) throw new ApiFailure(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。", 60);
  const hash = await sha256(JSON.stringify(input));
  const reservation = await reserveGeneration(env, session, input.requestId, hash);
  if (reservation.kind === "replay") return response({ requestId: input.requestId, raw: reservation.raw, quota: reservation.quota }, 200, env, request);
  let raw: string;
  try {
    const prompts = buildPrompts({ postContext: input.post, voiceProfile: input.profile, recentHistory: input.history, replyStyle: input.replyStyle } as any);
    raw = await provider(env, prompts.system, prompts.user);
    // The extension remains the sole parser of the shared structured response.
    const parsed = JSON.parse(raw);
    if (!parsed?.replies?.natural || !parsed?.replies?.light_humor || !parsed?.replies?.thoughtful) throw new Error("Invalid output");
  } catch (error) {
    await finishGeneration(env, session.user_id, input.requestId, null).catch(() => {});
    throw error instanceof ApiFailure ? error : new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。");
  }
  // A database write failure after an upstream result must keep the reservation
  // uncertain. Marking it as an upstream failure would invite a second paid call.
  await finishGeneration(env, session.user_id, input.requestId, raw);
  return response({ requestId: input.requestId, raw, quota: reservation.quota }, 200, env, request);
}
