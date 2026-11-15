import "../../utils/generation-performance.js";
import type { Env } from "./types";
import { ApiFailure } from "./types";
import { sessionFor, takeRate } from "./auth";
import { jsonBody, nowMs, sha256 } from "./security";
import { subscriptionsEnabled } from "./subscription-account";
import { response } from "./http";
import { finishGeneration, reserveGeneration, checkGenerationReplay } from "./quota";
import { buildPrompts } from "../../prompts/prompt-builder.js";
import { buildLiveProductionV3Prompts } from "../../prompts/prompt-v3-live-parity.js";
import { requestDeepSeek, validateDeepSeekResult } from "./deepseek-client.js";
import { executeAiGeneration } from "./ai-generation-flow.js";

import { normalizeAiInput } from "./ai-input.js";
import { decryptProviderApiKey } from "./ai-model-crypto";
import { requestConfiguredModel, serializeModelOutput } from "./ai-model-provider.js";

export const DEEPSEEK_MODEL = "deepseek-flash";

async function activeProvider(env: Env): Promise<{ config: any; apiKey: string } | null> {
  const pointer = await env.DB.prepare("SELECT active_config_id,active_version FROM ai_provider_runtime WHERE id=1").first<{active_config_id:string|null;active_version:number|null}>();
  if (!pointer?.active_config_id || !pointer.active_version) return null;
  if (!env.AI_CONFIG_ENCRYPTION_KEY) throw new ApiFailure(503,"AI_PROVIDER_CONFIG_ERROR","当前模型的加密配置不可用，请联系管理员。");
  const row = await env.DB.prepare(`SELECT c.archived,v.provider,v.protocol,v.base_url,v.model_id,v.api_key_ciphertext,v.input_rate_micro_usd_per_million,v.output_rate_micro_usd_per_million,v.max_output_tokens,v.timeout_ms,v.options_json,v.endpoint_addresses_json
    FROM ai_provider_configs c JOIN ai_provider_config_versions v ON v.config_id=c.id AND v.version=? WHERE c.id=?`).bind(pointer.active_version,pointer.active_config_id).first<any>();
  if (!row || row.archived || !row.api_key_ciphertext) throw new ApiFailure(503,"AI_PROVIDER_CONFIG_ERROR","当前模型配置不可用，请联系管理员。");
  let options: Record<string, unknown>, endpointAddresses: string[];
  try { options=JSON.parse(row.options_json); endpointAddresses=JSON.parse(row.endpoint_addresses_json); } catch { throw new ApiFailure(503,"AI_PROVIDER_CONFIG_ERROR","当前模型配置不可用，请联系管理员。"); }
  const config={configId:pointer.active_config_id,version:pointer.active_version,provider:row.provider,protocol:row.protocol,baseUrl:row.base_url,modelId:row.model_id,maxOutputTokens:row.max_output_tokens,timeoutMs:row.timeout_ms,options,endpointAddresses,inputRateMicroUsdPerMillion:row.input_rate_micro_usd_per_million,outputRateMicroUsdPerMillion:row.output_rate_micro_usd_per_million};
  let apiKey: string;
  try { apiKey=await decryptProviderApiKey(env.AI_CONFIG_ENCRYPTION_KEY,pointer.active_config_id,pointer.active_version,row.api_key_ciphertext); }
  catch { throw new ApiFailure(503,"AI_PROVIDER_CONFIG_ERROR","当前模型加密配置不可用，请联系管理员。"); }
  return {config,apiKey};
}

function configuredReservation(model: {config:any}, system: string, user: string): number {
  const inputBytes = new TextEncoder().encode(system).length + new TextEncoder().encode(user).length;
  const tokens = Math.ceil(inputBytes / 2); // conservative for multilingual prompts
  const config=model.config;
  const cost=Math.ceil(tokens*config.inputRateMicroUsdPerMillion/1_000_000+config.maxOutputTokens*config.outputRateMicroUsdPerMillion/1_000_000);
  const reserve=Math.ceil(cost*2);
  if(!Number.isSafeInteger(reserve)||reserve<1)throw new ApiFailure(503,"BUDGET_NOT_CONFIGURED","AI 成本预留无效。");
  return reserve;
}

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
  const trace = (globalThis as any).ReplyCopilotPerformance.createTrace({enabled:env.AI_PERFORMANCE_DIAGNOSTICS === "1"});
  const started = performance.now();
  const withTimings = (value: Record<string, unknown>) => {
    if (!trace.enabled) return value;
    trace.addDurations({worker_total:performance.now()-started});
    return {...value,performance:trace.snapshot("success")};
  };
  const { session } = await trace.measure("worker_auth",()=>sessionFor(request, env));
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
  const promptBuilder=env.ENVIRONMENT==="production"&&input.outputSchemaVersion===2?buildLiveProductionV3Prompts:buildPrompts;
  const prompts = promptBuilder({ postContext: input.post, voiceProfile: input.profile, recentHistory: input.history, styleStats: input.styleStats, replyStyle: input.replyStyle, outputSchemaVersion: input.outputSchemaVersion || 1 } as any);
  // Released clients cache quota.totalRemaining as generation eligibility.
  // Their parser accepts an absent quota on generation/ACK. Usage still carries
  // the original permanent balance fields and the server-owned status.
  const wireQuota=async (quota:unknown)=>{
    if(subscriptionsEnabled(env)&&await env.DB.prepare(
      "SELECT 1 FROM subscription_ai_allocations WHERE user_id=? AND request_id=?"
    ).bind(session.user_id,input.requestId).first())return {};
    return {quota};
  };
  const prior=await trace.measure("worker_replay",()=>checkGenerationReplay(env,session,input.requestId,hash));
  if(prior?.kind==="replay")return response(withTimings({requestId:input.requestId,raw:serializeModelOutput(prior.raw),...await wireQuota(prior.quota)}),200,env,request);
  const configuredModel=mode==="real"?await trace.measure("worker_config",()=>activeProvider(env)):null;
  if(mode==="real"&&!configuredModel&&!env.DEEPSEEK_API_KEY) throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","托管 AI 尚未配置。");
  const budgetReserve=configuredModel?configuredReservation(configuredModel,prompts.system,prompts.user):reservationCost(env,prompts.system,prompts.user,mode);
  trace.addDurations({worker_prepare:performance.now()-started});
  const execution = await executeAiGeneration({
    reserve: () => trace.measure("worker_reserve",()=>reserveGeneration(env, session, input.requestId, hash, budgetReserve, configuredModel?{id:configuredModel.config.configId,version:configuredModel.config.version}:null,{prechecked:true})),
    provider: () => configuredModel ? requestConfiguredModel({config:configuredModel.config,apiKey:configuredModel.apiKey,system:prompts.system,user:prompts.user,inputRateMicroUsdPerMillion:configuredModel.config.inputRateMicroUsdPerMillion,outputRateMicroUsdPerMillion:configuredModel.config.outputRateMicroUsdPerMillion,reservedCostMicroUsd:budgetReserve,performanceTrace:trace.enabled?trace:null}) : trace.measure("model",()=>provider(env, prompts.system, prompts.user, mode)),
    validate: (result: Awaited<ReturnType<typeof provider>>) => {
    if(mode==="real"&&!configuredModel) {
      try { validateDeepSeekResult(result); }
      catch { throw new ApiFailure(503,"AI_PROVIDER_UNAVAILABLE","AI 服务返回格式无效，请重试。"); }
    }
    // Validate the full shared contract for legacy and managed providers and
    // persist a wire representation accepted by both released client parsers.
    result.raw = serializeModelOutput(result.raw);
    },
    finish: (raw: string | null, usage: {model:string;inputTokens:number;outputTokens:number;costMicroUsd:number}|undefined) => trace.measure("worker_finish",()=>finishGeneration(env, session.user_id, input.requestId, raw, usage)),
  });
  if (execution.kind === "replay") return response(withTimings({ requestId: input.requestId, raw: serializeModelOutput(execution.raw), ...await wireQuota(execution.quota) }), 200, env, request);
  if (execution.kind === "abandoned") throw new ApiFailure(409,"GENERATION_ABANDONED","这次生成已结束，请使用新的回复请求。");
  if (execution.kind === "failed") {
    const error = execution.error;
    throw error instanceof ApiFailure ? error : new ApiFailure(503, "AI_PROVIDER_UNAVAILABLE", "AI 服务暂时不可用，请稍后重试。");
  }
  const { balance } = await import("./quota");
  return response(withTimings({ requestId: input.requestId, raw: execution.raw, ...await wireQuota(await balance(env,session.user_id)) }), 200, env, request);
}
