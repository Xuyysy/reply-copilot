import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, takeRate } from "./auth";
import { jsonBody, nowMs, sha256 } from "./security";
import { response } from "./http";
import { finishGeneration, reserveGeneration } from "./quota";
import { buildPrompts } from "../../prompts/prompt-builder.js";
import { requestDeepSeek, validateDeepSeekResult } from "./deepseek-client.js";
import { executeAiGeneration } from "./ai-generation-flow.js";

import { normalizeAiInput } from "./ai-input.js";

export const DEEPSEEK_MODEL = "deepseek-flash";

function aiMode(env:Env): "mock"|"real" {
  const mode=env.AI_MODE || (env.AI_MOCK==="1"?"mock":"production");
  if(mode==="mock") {
    if(env.ENVIRONMENT!=="development"&&env.ENVIRONMENT!=="staging") throw new ApiFailure(503,"SERVER_UNAVAILABLE","生产环境不能使用模拟 AI。");
    return "mock";
  }
  if(mode!=="production"||!["staging","production"].includes(env.ENVIRONMENT)) throw new ApiFailure(503,"AI_MODE_NOT_CONFIGURED","AI 模式与环境不匹配。");
  return "real";
}
function reservationCost(env:Env, system:string,user:string,mode:"mock"|"real"):number {
  if(mode==="mock") return env.ENVIRONMENT==="development"?Math.max(0,Number(env.AI_MOCK_COST_MICRO_USD)||0):0;
  const inputRate=Number(env.DEEPSEEK_INPUT_USD_PER_MILLION),outputRate=Number(env.DEEPSEEK_OUTPUT_USD_PER_MILLION);
  if(!Number.isFinite(inputRate)||inputRate<=0||!Number.isFinite(outputRate)||outputRate<=0) throw new ApiFailure(503,"COST_RATE_NOT_CONFIGURED","AI 成本费率尚未配置。");
  // UTF-8 byte length is a conservative bound for input tokens; reserve the full output limit.
  return Math.ceil((new TextEncoder().encode(system).length+new TextEncoder().encode(user).length)*inputRate+1200*outputRate)*2;
}
async function provider(env: Env, system: string, user: string, mode:"mock"|"real"): Promise<{raw:string;finishReason?:string;usage:{model:string;inputTokens:number;outputTokens:number;costMicroUsd:number}}> {
  if (mode === "mock") {
    if (user.includes("REPLY_COPILOT_FORCE_FAIL")) throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","本地模拟上游失败。");
    const delay=user.includes("REPLY_COPILOT_SLOW_TEST")?1500:Math.min(1000,Math.max(0,Number(env.AI_MOCK_DELAY_MS)||0));if(delay&&env.ENVIRONMENT==="development")await new Promise(resolve=>setTimeout(resolve,delay));
    return {raw:JSON.stringify({ recommendation: "reply", defaultStyle: "natural", language: "en", replies: { natural: "That detail really stayed with me. Thanks for putting it into words.", light_humor: "Well, this was more relatable than my inbox needed today.", thoughtful: "The quiet consistency behind this is easy to miss, but it matters." }, reason: "A conversational response fits the post.", quoteCandidate: null }),usage:{model:"mock",inputTokens:0,outputTokens:0,costMicroUsd:env.ENVIRONMENT==="development"?Math.max(0,Number(env.AI_MOCK_COST_MICRO_USD)||0):0}};
  }
  if (!env.DEEPSEEK_API_KEY) throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "托管 AI 尚未配置。");
  try {
    return await requestDeepSeek({
      apiKey: env.DEEPSEEK_API_KEY,
      system,
      user,
      inputRateUsdPerMillion: Number(env.DEEPSEEK_INPUT_USD_PER_MILLION),
      outputRateUsdPerMillion: Number(env.DEEPSEEK_OUTPUT_USD_PER_MILLION),
    });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
    if(code==='insufficient_balance')throw new ApiFailure(503,'AI_PROVIDER_BALANCE_EXHAUSTED','AI 服务商余额不足，请联系管理员处理。');
    if(code==='authentication_error')throw new ApiFailure(503,'AI_PROVIDER_CONFIG_ERROR','AI 服务商认证配置异常，请联系管理员。');
    if(code==='rate_limited')throw new ApiFailure(503,'AI_PROVIDER_RATE_LIMITED','AI 服务商请求繁忙，请稍后重试。');
    if(code==='timeout')throw new ApiFailure(503,'AI_PROVIDER_TIMEOUT','AI 服务响应超时，请稍后重试。');
    // Do not forward provider messages, response bodies, or credential-bearing request details.
    throw new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。");
  }
}
export async function generate(request: Request, env: Env): Promise<Response> {
  const { session } = await sessionFor(request, env);
  if (session.kind !== "extension") throw new ApiFailure(403, "FORBIDDEN", "请在已绑定的插件中生成回复。");
  const body = await jsonBody(request, 24_000);
  let input: ReturnType<typeof normalizeAiInput>;
  try { input = normalizeAiInput(body); }
  catch { throw new ApiFailure(400, "INVALID_REQUEST", "帖子或请求标识无效。"); }
  if (!await takeRate(env, `ai-user:${session.user_id}`, 40, 60_000, nowMs())) throw new ApiFailure(429, "RATE_LIMITED", "请求过于频繁，请稍后再试。", 60);
  const hash = await sha256(JSON.stringify(input));
  const enabled = await env.DB.prepare("SELECT value FROM system_settings WHERE key='ai_enabled'").first<{value:string}>();
  if (enabled?.value !== "1") throw new ApiFailure(503,"AI_DISABLED","AI 服务暂时停止，请稍后再试。");
  const mode=aiMode(env);
  if(mode==="real"&&!env.DEEPSEEK_API_KEY) throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","托管 AI 尚未配置。");
  const prompts = buildPrompts({ postContext: input.post, voiceProfile: input.profile, recentHistory: input.history, styleStats: input.styleStats, replyStyle: input.replyStyle } as any);
  const budgetReserve=reservationCost(env,prompts.system,prompts.user,mode);
  const execution = await executeAiGeneration({
    reserve: () => reserveGeneration(env, session, input.requestId, hash, budgetReserve),
    provider: () => provider(env, prompts.system, prompts.user, mode),
    validate: (result: Awaited<ReturnType<typeof provider>>) => {
    if(mode==="real") {
      try { validateDeepSeekResult(result); }
      catch { throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","AI 服务返回格式无效，请重试。"); }
    }
    // The extension remains the sole parser of the shared structured response.
    const parsed = JSON.parse(result.raw);
    if (!parsed?.replies?.natural || !parsed?.replies?.light_humor || !parsed?.replies?.thoughtful) throw new Error("Invalid output");
    },
    finish: (raw: string | null, usage: {model:string;inputTokens:number;outputTokens:number;costMicroUsd:number}|undefined) => finishGeneration(env, session.user_id, input.requestId, raw, usage),
  });
  if (execution.kind === "replay") return response({ requestId: input.requestId, raw: execution.raw, quota: execution.quota }, 200, env, request);
  if (execution.kind === "failed") {
    const error = execution.error;
    throw error instanceof ApiFailure ? error : new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。");
  }
  const { balance } = await import("./quota");
  return response({ requestId: input.requestId, raw: execution.raw, quota: await balance(env,session.user_id) }, 200, env, request);
}
