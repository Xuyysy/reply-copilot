import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, takeRate } from "./auth";
import { jsonBody, nowMs, sha256 } from "./security";
import { response } from "./http";
import { finishGeneration, reserveGeneration } from "./quota";
import { buildPrompts } from "../../prompts/prompt-builder.js";

export const DEEPSEEK_MODEL = "deepseek-flash";

function normalizeInput(body: Record<string, unknown>) {
  const requestId = typeof body.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.requestId) ? body.requestId : "";
  const post = body.post && typeof body.post === "object" && !Array.isArray(body.post) ? body.post as Record<string,unknown> : {};
  const text = typeof post.text === "string" ? post.text.trim() : "";
  const url = typeof post.url === "string" ? post.url : "";
  if (!requestId || !text || text.length > 12_000 || (url && !/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/\d+/.test(url))) throw new ApiFailure(400, "INVALID_REQUEST", "帖子或请求标识无效。");
  const profile = body.voiceProfile && typeof body.voiceProfile === "object" && !Array.isArray(body.voiceProfile) ? body.voiceProfile : undefined;
  const history = Array.isArray(body.recentHistory) ? body.recentHistory.slice(0, 20) : [];
  const styleStats = body.styleStats && typeof body.styleStats === "object" && !Array.isArray(body.styleStats) ? body.styleStats : undefined;
  const replyStyle = ["natural-friendly", "short", "balanced"].includes(String(body.replyStyle)) ? String(body.replyStyle) : "natural-friendly";
  return { requestId, post: { text, url }, profile, history, styleStats, replyStyle };
}
function aiMode(env:Env, email:string): "mock"|"real" {
  const mode=env.AI_MODE || (env.AI_MOCK==="1"?"mock":"production");
  if(mode==="mock") {
    if(env.ENVIRONMENT!=="development"&&env.ENVIRONMENT!=="staging") throw new ApiFailure(503,"SERVER_UNAVAILABLE","生产环境不能使用模拟 AI。");
    return "mock";
  }
  if(mode==="real-test") {
    const cap=Number(env.REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD);
    if(env.ENVIRONMENT!=="staging"||env.REAL_DEEPSEEK_TEST_ENABLED!=="1"||email.toLowerCase()!==env.REAL_DEEPSEEK_TEST_USER_EMAIL?.toLowerCase()||!Number.isSafeInteger(cap)||cap<1||cap>100000||Number(env.SITE_DAILY_CAP)>10) throw new ApiFailure(503,"REAL_AI_TEST_DISABLED","真实 AI 联调尚未由管理员开启。");
    return "real";
  }
  if(mode!=="production"||env.ENVIRONMENT!=="production") throw new ApiFailure(503,"AI_MODE_NOT_CONFIGURED","AI 模式与环境不匹配。");
  return "real";
}
function reservationCost(env:Env, system:string,user:string,mode:"mock"|"real"):number {
  if(mode==="mock") return env.ENVIRONMENT==="development"?Math.max(0,Number(env.AI_MOCK_COST_MICRO_USD)||0):0;
  const inputRate=Number(env.DEEPSEEK_INPUT_USD_PER_MILLION),outputRate=Number(env.DEEPSEEK_OUTPUT_USD_PER_MILLION);
  if(!Number.isFinite(inputRate)||inputRate<=0||!Number.isFinite(outputRate)||outputRate<=0) throw new ApiFailure(503,"COST_RATE_NOT_CONFIGURED","AI 成本费率尚未配置。");
  // UTF-8 byte length is a conservative bound for input tokens; reserve the full output limit.
  return Math.ceil((new TextEncoder().encode(system).length+new TextEncoder().encode(user).length)*inputRate+1200*outputRate)*2;
}
async function provider(env: Env, system: string, user: string, mode:"mock"|"real"): Promise<{raw:string;usage:{model:string;inputTokens:number;outputTokens:number;costMicroUsd:number}}> {
  if (mode === "mock") {
    if (user.includes("REPLY_COPILOT_FORCE_FAIL")) throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","本地模拟上游失败。");
    const delay=user.includes("REPLY_COPILOT_SLOW_TEST")?1500:Math.min(1000,Math.max(0,Number(env.AI_MOCK_DELAY_MS)||0));if(delay&&env.ENVIRONMENT==="development")await new Promise(resolve=>setTimeout(resolve,delay));
    return {raw:JSON.stringify({ recommendation: "reply", defaultStyle: "natural", language: "en", replies: { natural: "That detail really stayed with me. Thanks for putting it into words.", light_humor: "Well, this was more relatable than my inbox needed today.", thoughtful: "The quiet consistency behind this is easy to miss, but it matters." }, reason: "A conversational response fits the post.", quoteCandidate: null }),usage:{model:"mock",inputTokens:0,outputTokens:0,costMicroUsd:env.ENVIRONMENT==="development"?Math.max(0,Number(env.AI_MOCK_COST_MICRO_USD)||0):0}};
  }
  if (!env.DEEPSEEK_API_KEY) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "托管 AI 尚未配置。");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: DEEPSEEK_MODEL, messages: [{role:"system",content:system},{role:"user",content:user}], response_format: {type:"json_object"}, max_tokens: 1200, thinking: {type:"disabled"} }), signal: controller.signal });
    if (!upstream.ok) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用。");
    const data = await upstream.json() as { model?:string; usage?:{prompt_tokens?:number;completion_tokens?:number}; choices?: Array<{message?:{content?:string}}> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw || raw.length > 20_000) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务返回内容无效。");
    const inputTokens=data.usage?.prompt_tokens; const outputTokens=data.usage?.completion_tokens;
    if(typeof inputTokens!=="number"||typeof outputTokens!=="number"||!Number.isSafeInteger(inputTokens)||!Number.isSafeInteger(outputTokens)||inputTokens<0||outputTokens<0) throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","AI 服务未返回有效用量。");
    const inputRate=Number(env.DEEPSEEK_INPUT_USD_PER_MILLION || 0); const outputRate=Number(env.DEEPSEEK_OUTPUT_USD_PER_MILLION || 0);
    const costMicroUsd=Math.ceil(inputTokens*inputRate+outputTokens*outputRate);
    return {raw,usage:{model:data.model || DEEPSEEK_MODEL,inputTokens,outputTokens,costMicroUsd}};
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
  const enabled = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_enabled'").first<{value:string}>();
  if (enabled?.value !== "1") throw new ApiFailure(503,"AI_DISABLED","AI 服务暂时停止，请稍后再试。");
  const mode=aiMode(env,session.email);
  if(mode==="real"&&!env.DEEPSEEK_API_KEY) throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","托管 AI 尚未配置。");
  const prompts = buildPrompts({ postContext: input.post, voiceProfile: input.profile, recentHistory: input.history, styleStats: input.styleStats, replyStyle: input.replyStyle } as any);
  const budgetReserve=reservationCost(env,prompts.system,prompts.user,mode);
  if(env.ENVIRONMENT==="staging"&&mode==="real") {
    const configured=await env.DB.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").first<{value:string}>();
    if(Number(configured?.value)>Number(env.REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD)) throw new ApiFailure(503,"REAL_AI_TEST_DISABLED","真实 AI 联调预算尚未限制。");
  }
  const reservation = await reserveGeneration(env, session, input.requestId, hash,budgetReserve);
  if (reservation.kind === "replay") return response({ requestId: input.requestId, raw: reservation.raw, quota: reservation.quota }, 200, env, request);
  let raw: string; let usage: {model:string;inputTokens:number;outputTokens:number;costMicroUsd:number}|undefined;
  try {
    const result = await provider(env, prompts.system, prompts.user,mode); raw=result.raw; usage=result.usage;
    // The extension remains the sole parser of the shared structured response.
    const parsed = JSON.parse(raw);
    if (!parsed?.replies?.natural || !parsed?.replies?.light_humor || !parsed?.replies?.thoughtful) throw new Error("Invalid output");
  } catch (error) {
    await finishGeneration(env, session.user_id, input.requestId, null,usage).catch(() => {});
    throw error instanceof ApiFailure ? error : new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。");
  }
  // A database write failure after an upstream result must keep the reservation
  // uncertain. Marking it as an upstream failure would invite a second paid call.
  await finishGeneration(env, session.user_id, input.requestId, raw,usage);
  const { balance } = await import("./quota");
  return response({ requestId: input.requestId, raw, quota: await balance(env,session.user_id) }, 200, env, request);
}
