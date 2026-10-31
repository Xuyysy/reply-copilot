import type { Env } from "./types";
import { ApiFailure } from "./types";
import { jsonBody, nowMs, uuid, hmac } from "./security";
import { requireAdminSession } from "./admin-auth";
import { operation, commitOperation } from "./admin-operations";
import { response } from "./http";
import { encryptProviderApiKey, decryptProviderApiKey } from "./ai-model-crypto";
import { validateProviderEndpoint, requestConfiguredModel, ModelProviderError } from "./ai-model-provider.js";
import { buildPrompts } from "../../prompts/prompt-builder.js";

// Per-request safety ceiling is retained; no admin-only daily count/budget cap.
// All model tests still reserve funds under the shared site-wide AI daily budget.
const TEST_BUDGET_MICRO_USD = 50_000;
const TEST_PROMPTS = {
  zh: "今天把复杂问题拆成小步骤，终于推进了一点。",
  en: "I finally made progress by breaking a complicated problem into smaller steps today.",
};
const CONNECTION_JSON_SYSTEM = 'Return only a valid JSON object with exactly one property: {"ok":true}. Do not use Markdown or add any other text.';
const CONNECTION_JSON_USER = 'Connection check. Return exactly {"ok":true} as JSON.';
type Config = {
  id: string; display_name: string; latest_version: number; archived: number;
  provider: string; protocol: string; base_url: string; model_id: string;
  api_key_ciphertext: string; input_rate_micro_usd_per_million: number;
  output_rate_micro_usd_per_million: number; max_output_tokens: number;
  timeout_ms: number; options_json: string; endpoint_addresses_json: string;
};

function safeError(error: unknown): string {
  if (error instanceof ModelProviderError) return error.code;
  const code = error instanceof Error ? error.message : "provider_error";
  return /^[a-z_]{3,48}$/.test(code) ? code : "provider_error";
}
function isConnectionJson(content: unknown): boolean {
  if (typeof content !== "string") return false;
  try {
    const value = JSON.parse(content);
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && value.ok === true && Object.keys(value).length === 1);
  } catch { return false; }
}
function decimalRate(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "Token 价格无效。");
  const string = String(value);
  if (!/^\d{1,5}(?:\.\d{1,6})?$/.test(string)) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "Token 价格无效。");
  const amount = Number(string);
  const micro = Math.round(amount * 1_000_000);
  if (!Number.isSafeInteger(micro) || micro <= 0 || Math.abs(amount * 1_000_000 - micro) > 1e-7) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "Token 价格必须是正数。");
  return micro;
}
function parseConfig(row: Config) {
  let options: Record<string, unknown>;
  let endpointAddresses: string[];
  try { options = JSON.parse(row.options_json); endpointAddresses = JSON.parse(row.endpoint_addresses_json); }
  catch { throw new ApiFailure(503, "MODEL_CONFIG_INVALID", "模型配置需要重新保存。"); }
  return {
    configId: row.id, version: row.latest_version, displayName: row.display_name, provider: row.provider,
    protocol: row.protocol, baseUrl: row.base_url, modelId: row.model_id,
    inputRateMicroUsdPerMillion: row.input_rate_micro_usd_per_million,
    outputRateMicroUsdPerMillion: row.output_rate_micro_usd_per_million,
    maxOutputTokens: row.max_output_tokens, timeoutMs: row.timeout_ms, options, endpointAddresses,
  };
}
function publicMeta(row: Config, active: boolean, previous: boolean, latestTests: unknown[]) {
  return { id: row.id, name: row.display_name, version: row.latest_version, archived: Boolean(row.archived), provider: row.provider,
    protocol: row.protocol, baseUrl: row.base_url, modelId: row.model_id,
    inputRateUsdPerMillion: row.input_rate_micro_usd_per_million / 1_000_000,
    outputRateUsdPerMillion: row.output_rate_micro_usd_per_million / 1_000_000,
    maxOutputTokens: row.max_output_tokens, timeoutMs: row.timeout_ms,
    options: JSON.parse(row.options_json), keyConfigured: true, active, previous, tests: latestTests };
}
async function readConfig(env: Env, id: string, version?: number): Promise<Config | null> {
  const row = await env.DB.prepare(`SELECT c.id,c.display_name,c.latest_version,c.archived,v.provider,v.protocol,v.base_url,v.model_id,v.api_key_ciphertext,v.input_rate_micro_usd_per_million,v.output_rate_micro_usd_per_million,v.max_output_tokens,v.timeout_ms,v.options_json,v.endpoint_addresses_json
    FROM ai_provider_configs c JOIN ai_provider_config_versions v ON v.config_id=c.id AND v.version=COALESCE(?,c.latest_version) WHERE c.id=?`).bind(version ?? null, id).first<Config>();
  return row ?? null;
}
export async function listAiModels(request: Request, env: Env): Promise<Response> {
  await requireAdminSession(request, env);
  const [runtime, configs] = await Promise.all([
    env.DB.prepare("SELECT active_config_id,active_version,previous_config_id,previous_version,previous_is_legacy FROM ai_provider_runtime WHERE id=1").first<any>(),
    env.DB.prepare(`SELECT c.id,c.display_name,c.latest_version,c.archived,v.provider,v.protocol,v.base_url,v.model_id,v.api_key_ciphertext,v.input_rate_micro_usd_per_million,v.output_rate_micro_usd_per_million,v.max_output_tokens,v.timeout_ms,v.options_json,v.endpoint_addresses_json
      FROM ai_provider_configs c JOIN ai_provider_config_versions v ON v.config_id=c.id AND v.version=c.latest_version ORDER BY c.updated_at DESC`).all<Config>(),
  ]);
  const items = await Promise.all((configs.results ?? []).map(async row => {
    const tests = await env.DB.prepare(`SELECT test_kind,status,error_category,upstream_http_status,latency_ms,input_tokens,output_tokens,estimated_cost_micro_usd,usage_verified,json_valid,created_at,completed_at
      FROM ai_provider_tests WHERE config_id=? AND config_version=? ORDER BY created_at DESC LIMIT 6`).bind(row.id, row.latest_version).all();
    return publicMeta(row, runtime?.active_config_id === row.id && runtime?.active_version === row.latest_version,
      runtime?.previous_config_id === row.id && runtime?.previous_version === row.latest_version, tests.results ?? []);
  }));
  const [activeConfig,previousConfig]=await Promise.all([
    runtime?.active_config_id?readConfig(env,runtime.active_config_id,runtime.active_version):null,
    runtime?.previous_config_id?readConfig(env,runtime.previous_config_id,runtime.previous_version):null,
  ]);
  const active=activeConfig?{id:activeConfig.id,version:runtime.active_version,name:activeConfig.display_name,modelId:activeConfig.model_id,provider:activeConfig.provider}:null;
  const previous=previousConfig?{id:previousConfig.id,version:runtime.previous_version,name:previousConfig.display_name,modelId:previousConfig.model_id,provider:previousConfig.provider}:runtime?.previous_is_legacy?{id:null,version:null,name:"DeepSeek legacy",modelId:"deepseek-flash",provider:"deepseek"}:null;
  return response({ active, previous, previousAvailable:Boolean(previous), legacyFallback: !runtime?.active_config_id, configs: items }, 200, env, request);
}

export async function saveAiModel(request: Request, env: Env): Promise<Response> {
  const actor = await requireAdminSession(request, env, true);
  if (!env.AI_CONFIG_ENCRYPTION_KEY) throw new ApiFailure(503, "MODEL_ENCRYPTION_NOT_CONFIGURED", "Staging 模型加密 Secret 尚未配置。");
  const body = await jsonBody(request, 8192);
  const id = typeof body.id === "string" ? body.id : uuid();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "配置编号无效。");
  const displayName = typeof body.name === "string" ? body.name.trim() : "";
  const provider = body.provider;
  const protocol = body.protocol ?? "openai_chat";
  const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().replace(/\/$/, "") : "";
  if (!displayName || displayName.length > 80 || !["deepseek", "qwen", "gemini", "openai_compatible"].includes(String(provider)) || protocol !== "openai_chat" || !modelId || modelId.length > 160) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "模型名称、厂商、协议或模型 ID 无效。");
  const suppliedOptions = body.options && typeof body.options === "object" && !Array.isArray(body.options) ? body.options as Record<string, unknown> : {};
  if (provider === "qwen" && suppliedOptions.jsonMode !== undefined && typeof suppliedOptions.jsonMode !== "boolean") throw new ApiFailure(400,"INVALID_MODEL_CONFIG","Qwen JSON Mode 选项无效。");
  const options: Record<string, unknown> = provider === "qwen" ? {
    ...(suppliedOptions.thinkingMode === "enabled" || suppliedOptions.thinkingMode === "disabled" ? { thinkingMode: suppliedOptions.thinkingMode } : {}),
    jsonMode: suppliedOptions.jsonMode !== false,
  } : provider === "openai_compatible" ? { customEndpointRiskConfirmed: suppliedOptions.customEndpointRiskConfirmed === true } : {};
  const config = { provider, protocol, baseUrl, modelId, maxOutputTokens: Number(body.maxOutputTokens), timeoutMs: Number(body.timeoutMs), options, endpointAddresses: [] as string[] };
  if (!Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 64 || config.maxOutputTokens > 8192 || !Number.isInteger(config.timeoutMs) || config.timeoutMs < 3000 || config.timeoutMs > 60000) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "Token 上限或超时时间无效。");
  if (provider === "qwen" && suppliedOptions.thinkingMode !== undefined && !["enabled", "disabled"].includes(String(suppliedOptions.thinkingMode))) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "Qwen Thinking 参数无效。");
  if (provider === "qwen" && config.options.thinkingMode === "enabled" && config.options.jsonMode === true) throw new ApiFailure(400, "INVALID_MODEL_CONFIG", "此配置不能同时启用 Qwen Thinking 与 JSON Mode；请按所选模型支持情况配置其中一项。");
  try { config.endpointAddresses = await validateProviderEndpoint(config as any); }
  catch (error) { throw new ApiFailure(400,"INVALID_MODEL_ENDPOINT",safeError(error)); }
  if (provider === "openai_compatible" && config.options.customEndpointRiskConfirmed !== true) throw new ApiFailure(400,"CUSTOM_ENDPOINT_CONFIRMATION_REQUIRED","自定义接口需确认其服务方可信，且只会收到模型请求内容与 API Key。");
  if (provider === "qwen" && config.options.jsonMode !== undefined && typeof config.options.jsonMode !== "boolean") throw new ApiFailure(400,"INVALID_MODEL_CONFIG","Qwen JSON Mode 选项无效。");
  const inputRate = decimalRate(body.inputRateUsdPerMillion), outputRate = decimalRate(body.outputRateUsdPerMillion);
  const prior = await readConfig(env, id);
  if (!prior && typeof body.apiKey !== "string") throw new ApiFailure(400, "API_KEY_REQUIRED", "新配置需要填写 API Key。");
  if (prior?.archived) throw new ApiFailure(409, "MODEL_ARCHIVED", "此配置已停用，请先恢复后再编辑。");
  const version = prior ? prior.latest_version + 1 : 1;
  let apiKey: string;
  if (typeof body.apiKey === "string" && body.apiKey.length) apiKey = body.apiKey;
  else if (prior) apiKey = await decryptProviderApiKey(env.AI_CONFIG_ENCRYPTION_KEY, id, prior.latest_version, prior.api_key_ciphertext);
  else throw new ApiFailure(400, "API_KEY_REQUIRED", "请填写 API Key。");
  if (apiKey.length < 8 || apiKey.length > 512 || /[\u0000-\u001f\u007f]/.test(apiKey)) throw new ApiFailure(400,"INVALID_API_KEY","API Key 格式无效。");
  const now = nowMs();
  // Key material is never passed to generic operation fingerprinting. A
  // keyed digest allows safe idempotent retries without storing the key or a
  // publicly brute-forceable plain SHA-256 of it.
  const keyFingerprint = await hmac(env, `ai-model-api-key:${apiKey}`);
  const safeBody = { operationId: body.operationId, reason: body.reason, id, name: displayName, provider, protocol, baseUrl, modelId, inputRate, outputRate, maxOutputTokens: config.maxOutputTokens, timeoutMs: config.timeoutMs, options: config.options, apiKeyUpdated: Boolean(body.apiKey), keyFingerprint };
  const action = prior ? "ai_model_version_save" : "ai_model_create";
  const op = await operation(env, actor, safeBody, action, id);
  if (op.replayed) {
    const current=await readConfig(env,id);
    return response({ok:true,id,version:current?.latest_version??version,keyConfigured:true,replayed:true},200,env,request);
  }
  const ciphertext = await encryptProviderApiKey(env.AI_CONFIG_ENCRYPTION_KEY, id, version, apiKey);
  const meta = { provider, protocol, base_url: baseUrl, model_id: modelId, input_rate_micro_usd_per_million: inputRate, output_rate_micro_usd_per_million: outputRate, max_output_tokens: config.maxOutputTokens, timeout_ms: config.timeoutMs, options_json: JSON.stringify(config.options), endpoint_addresses_json: JSON.stringify(config.endpointAddresses) };
  const before = prior ? { id, version: prior.latest_version, provider: prior.provider, modelId: prior.model_id, keyConfigured: true } : null;
  const after = { id, version, name: displayName, ...meta, apiKeyUpdated: Boolean(body.apiKey), keyConfigured: true };
  const statements: D1PreparedStatement[] = prior ? [
    env.DB.prepare("INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,version,provider,protocol,baseUrl,modelId,ciphertext,inputRate,outputRate,config.maxOutputTokens,config.timeoutMs,JSON.stringify(config.options),JSON.stringify(config.endpointAddresses),now,actor.user_id),
    env.DB.prepare("UPDATE ai_provider_configs SET display_name=?,latest_version=?,updated_at=?,updated_by=? WHERE id=? AND latest_version=? AND archived=0").bind(displayName,version,now,actor.user_id,id,prior.latest_version),
  ] : [
    env.DB.prepare("INSERT INTO ai_provider_configs(id,display_name,latest_version,created_at,updated_at,updated_by) VALUES(?,?,1,?,?,?)").bind(id,displayName,now,now,actor.user_id),
    env.DB.prepare("INSERT INTO ai_provider_config_versions(config_id,version,provider,protocol,base_url,model_id,api_key_ciphertext,input_rate_micro_usd_per_million,output_rate_micro_usd_per_million,max_output_tokens,timeout_ms,options_json,endpoint_addresses_json,created_at,created_by) VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id,provider,protocol,baseUrl,modelId,ciphertext,inputRate,outputRate,config.maxOutputTokens,config.timeoutMs,JSON.stringify(config.options),JSON.stringify(config.endpointAddresses),now,actor.user_id),
  ];
  await commitOperation(env, op, statements, before, after);
  return response({ ok: true, id, version, keyConfigured: true, replayed: op.replayed }, 200, env, request);
}

async function latestConfig(env: Env, id: string): Promise<Config> {
  const row = await readConfig(env, id);
  if (!row || row.archived) throw new ApiFailure(404, "MODEL_NOT_FOUND", "模型配置不存在或已停用。");
  return row;
}
function costReservation(config: ReturnType<typeof parseConfig>, system: string, user: string, outputLimit: number) {
  const inputTokens = Math.ceil((new TextEncoder().encode(system).length + new TextEncoder().encode(user).length) / 3);
  const amount = Math.ceil(inputTokens * config.inputRateMicroUsdPerMillion / 1_000_000 + outputLimit * config.outputRateMicroUsdPerMillion / 1_000_000);
  const reserve = Math.ceil(amount * 2);
  if (!Number.isSafeInteger(reserve) || reserve < 1 || reserve > TEST_BUDGET_MICRO_USD) throw new ApiFailure(400, "TEST_COST_LIMIT", "本次测试预估成本超过单次安全上限。");
  return reserve;
}
async function runTest(request: Request, env: Env, id: string, requestedKind: "connection" | "generation"): Promise<Response> {
  const actor = await requireAdminSession(request, env, true);
  if (!env.AI_CONFIG_ENCRYPTION_KEY) throw new ApiFailure(503, "MODEL_ENCRYPTION_NOT_CONFIGURED", "Staging 模型加密 Secret 尚未配置。");
  // Burst protection remains, without the previous 10-tests-per-day ceiling.
  if (!await import("./auth").then(module => module.takeRate(env, `admin-ai-test-minute:${actor.user_id}`, 30, 60_000, nowMs()))) throw new ApiFailure(429, "MODEL_TEST_RATE_LIMIT", "测试操作过于频繁，请稍后再试。");
  const row = await latestConfig(env, id), config = parseConfig(row);
  const actorBody = await jsonBody(request, 4096);
  if (requestedKind === "generation" && actorBody.language !== "zh" && actorBody.language !== "en") throw new ApiFailure(400,"INVALID_TEST","请选择中文或英文测试语言。");
  const kind = requestedKind === "connection" ? "connection" : actorBody.language === "en" ? "generation_en" : "generation_zh";
  if (typeof actorBody.testId !== "string" || !/^[0-9a-f-]{36}$/i.test(actorBody.testId)) throw new ApiFailure(400, "INVALID_TEST", "测试编号无效。");
  const existingTest = await env.DB.prepare("SELECT admin_user_id,config_id,config_version,test_kind,status,error_category,upstream_http_status,latency_ms,input_tokens,output_tokens,estimated_cost_micro_usd,usage_verified,json_valid FROM ai_provider_tests WHERE id=?").bind(actorBody.testId).first<any>();
  if (existingTest && (existingTest.admin_user_id!==actor.user_id||existingTest.config_id!==id||existingTest.config_version!==row.latest_version||existingTest.test_kind!==kind)) throw new ApiFailure(409,"MODEL_TEST_ID_CONFLICT","测试编号已用于其他请求。");
  if (existingTest && existingTest.status !== "running") return response({ ok: existingTest.status === "passed", replayed: true, ...testResult(existingTest) }, 200, env, request);
  if (existingTest) throw new ApiFailure(409, "MODEL_TEST_IN_PROGRESS", "本次测试仍在执行，请稍后刷新结果。");
  const prompt = kind === "connection" ? { system: CONNECTION_JSON_SYSTEM, user: CONNECTION_JSON_USER } : buildPrompts({ postContext: { text: TEST_PROMPTS[kind === "generation_zh" ? "zh" : "en"] }, voiceProfile: null, recentHistory: [], styleStats: null, replyStyle: "natural" } as any);
  const outputLimit = kind === "connection" ? 32 : Math.min(1024, config.maxOutputTokens);
  const reserve = costReservation(config, prompt.system, prompt.user, outputLimit);
  const apiKey = await decryptProviderApiKey(env.AI_CONFIG_ENCRYPTION_KEY, id, row.latest_version, row.api_key_ciphertext);
  const day = new Date().toISOString().slice(0, 10);
  const globalSetting = await env.DB.prepare("SELECT value FROM system_settings WHERE key='daily_cost_limit_micro_usd'").first<{value:string}>();
  const globalLimit = Number(globalSetting?.value);
  if (!Number.isSafeInteger(globalLimit) || globalLimit < 1) throw new ApiFailure(503, "BUDGET_NOT_CONFIGURED", "AI 成本预算尚未配置。");
  const claimToken = uuid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO ai_provider_test_budget_days(budget_day) VALUES(?) ON CONFLICT(budget_day) DO NOTHING").bind(day),
    env.DB.prepare("INSERT INTO ai_budget_days(budget_day) VALUES(?) ON CONFLICT(budget_day) DO NOTHING").bind(day),
    env.DB.prepare(`INSERT INTO ai_provider_test_budget_claims(test_id,claim_token,budget_day,reserved_micro_usd,created_at)
      SELECT ?,?,?,?,? WHERE
        (SELECT reserved_micro_usd+settled_micro_usd FROM ai_budget_days WHERE budget_day=?)+?<=?
      ON CONFLICT(test_id) DO NOTHING`).bind(actorBody.testId,claimToken,day,reserve,nowMs(),day,reserve,globalLimit),
    // Legacy schema enforces CHECK(calls<=10): saturate this obsolete metric,
    // and use ai_provider_tests rows for the authoritative test count.
    env.DB.prepare(`UPDATE ai_provider_test_budget_days SET calls=CASE WHEN calls<10 THEN calls+1 ELSE calls END,reserved_micro_usd=reserved_micro_usd+?
      WHERE budget_day=? AND EXISTS(SELECT 1 FROM ai_provider_test_budget_claims WHERE test_id=? AND claim_token=? AND budget_day=?)`).bind(reserve,day,actorBody.testId,claimToken,day),
    env.DB.prepare(`UPDATE ai_budget_days SET reserved_micro_usd=reserved_micro_usd+?
      WHERE budget_day=? AND EXISTS(SELECT 1 FROM ai_provider_test_budget_claims WHERE test_id=? AND claim_token=? AND budget_day=?)`).bind(reserve,day,actorBody.testId,claimToken,day),
    env.DB.prepare("INSERT INTO ai_provider_tests(id,admin_user_id,config_id,config_version,test_kind,status,estimated_cost_micro_usd,created_at) SELECT ?,?,?,?,?,'running',?,? WHERE EXISTS(SELECT 1 FROM ai_provider_test_budget_claims WHERE test_id=? AND claim_token=? AND budget_day=?)").bind(actorBody.testId,actor.user_id,id,row.latest_version,kind,reserve,nowMs(),actorBody.testId,claimToken,day),
  ]);
  const ownsClaim = await env.DB.prepare("SELECT 1 AS ok FROM ai_provider_test_budget_claims WHERE test_id=? AND claim_token=?").bind(actorBody.testId,claimToken).first<{ok:number}>();
  if (!ownsClaim) {
    const concurrent = await env.DB.prepare("SELECT status FROM ai_provider_tests WHERE id=? AND admin_user_id=?").bind(actorBody.testId,actor.user_id).first<{status:string}>();
    if (concurrent && concurrent.status !== "running") {
      const replay = await env.DB.prepare("SELECT status,error_category,upstream_http_status,latency_ms,input_tokens,output_tokens,estimated_cost_micro_usd,usage_verified,json_valid FROM ai_provider_tests WHERE id=?").bind(actorBody.testId).first<any>();
      return response({ ok: concurrent.status === "passed", replayed: true, ...testResult(replay) },200,env,request);
    }
    if (concurrent) throw new ApiFailure(409,"MODEL_TEST_IN_PROGRESS","本次测试仍在执行，请稍后刷新结果。");
    throw new ApiFailure(429, "MODEL_TEST_BUDGET_EXHAUSTED", "模型测试所需预算已超过全站 AI 每日预算。");
  }
  const claimed = await env.DB.prepare("SELECT status FROM ai_provider_tests WHERE id=? AND admin_user_id=?").bind(actorBody.testId,actor.user_id).first<{status:string}>();
  if (!claimed) throw new ApiFailure(429, "MODEL_TEST_BUDGET_EXHAUSTED", "模型测试所需预算已超过全站 AI 每日预算。");
  const started = nowMs();
  let usage: any = { model: "unknown-estimated", inputTokens: 0, outputTokens: 0, costMicroUsd: reserve, usageQuality: "estimated" };
  let result: any = null, errorCategory: string | null = null, jsonValid = false, upstreamHttpStatus: number | null = null;
  try {
    result = await requestConfiguredModel({ config:kind==="connection"?config:{...config,maxOutputTokens:outputLimit}, apiKey, system: prompt.system, user: prompt.user,
      inputRateMicroUsdPerMillion: config.inputRateMicroUsdPerMillion, outputRateMicroUsdPerMillion: config.outputRateMicroUsdPerMillion,
      reservedCostMicroUsd: reserve, testMode: kind === "connection", validateOutput: kind !== "connection" });
    usage = result.usage;
    jsonValid = kind === "connection" ? isConnectionJson(result.content) : Boolean(result.raw);
    if (kind === "connection" && !jsonValid) throw new ModelProviderError("connection_check_failed", result.httpStatus, reserve, usage);
  } catch (error) { errorCategory = safeError(error); if (error instanceof ModelProviderError) { upstreamHttpStatus=error.status; if (error.usage) usage = error.usage; } }
  const passed = !errorCategory && (!kind.startsWith("generation_") || jsonValid) && usage.usageQuality === "verified";
  const settled = usage?.usageQuality === "verified" && Number.isSafeInteger(usage.costMicroUsd) && usage.costMicroUsd <= reserve ? usage.costMicroUsd : reserve;
  const completed = nowMs();
  await env.DB.batch([
    env.DB.prepare("UPDATE ai_provider_tests SET status=?,error_category=?,upstream_http_status=?,latency_ms=?,input_tokens=?,output_tokens=?,estimated_cost_micro_usd=?,usage_verified=?,json_valid=?,completed_at=? WHERE id=? AND status='running'").bind(passed?"passed":"failed",errorCategory,result?.httpStatus??upstreamHttpStatus,completed-started,usage?.inputTokens??0,usage?.outputTokens??0,settled,usage?.usageQuality==="verified"?1:0,jsonValid?1:0,completed,actorBody.testId),
    env.DB.prepare("UPDATE ai_provider_test_budget_days SET reserved_micro_usd=MAX(0,reserved_micro_usd-?),settled_micro_usd=settled_micro_usd+? WHERE budget_day=? AND EXISTS(SELECT 1 FROM ai_provider_test_budget_claims WHERE test_id=? AND budget_day=?)").bind(reserve,settled,day,actorBody.testId,day),
    env.DB.prepare("UPDATE ai_budget_days SET reserved_micro_usd=MAX(0,reserved_micro_usd-?),settled_micro_usd=settled_micro_usd+? WHERE budget_day=? AND EXISTS(SELECT 1 FROM ai_provider_test_budget_claims WHERE test_id=? AND budget_day=?)").bind(reserve,settled,day,actorBody.testId,day),
  ]);
  const test = await env.DB.prepare("SELECT status,error_category,upstream_http_status,latency_ms,input_tokens,output_tokens,estimated_cost_micro_usd,usage_verified,json_valid FROM ai_provider_tests WHERE id=?").bind(actorBody.testId).first<any>();
  return response({ ok: passed, replayed: false, ...testResult(test) }, 200, env, request);
}
function testResult(row: any) {
  return { status: row?.status, errorCategory: row?.error_category ?? null, httpStatus: row?.upstream_http_status ?? null,
    latencyMs: row?.latency_ms ?? null, inputTokens: row?.input_tokens ?? null, outputTokens: row?.output_tokens ?? null,
    estimatedCostMicroUsd: row?.estimated_cost_micro_usd ?? null, usageVerified: Boolean(row?.usage_verified), jsonValid: Boolean(row?.json_valid) };
}
export const testAiModelConnection = (request: Request, env: Env, id: string) => runTest(request, env, id, "connection");
export const testAiModelGeneration = (request: Request, env: Env, id: string) => runTest(request, env, id, "generation");

export async function activateAiModel(request: Request, env: Env, id: string): Promise<Response> {
  const actor = await requireAdminSession(request, env, true), body = await jsonBody(request, 4096), row = await latestConfig(env, id);
  const now = nowMs(), cutoff = now - 24 * 60 * 60_000;
  const tests = await env.DB.prepare("SELECT test_kind,status,usage_verified,json_valid,completed_at FROM ai_provider_tests WHERE config_id=? AND config_version=? AND completed_at>=? ORDER BY completed_at DESC").bind(id,row.latest_version,cutoff).all<any>();
  const latest = new Map<string, any>(); for (const item of tests.results ?? []) if (!latest.has(item.test_kind)) latest.set(item.test_kind,item);
  if (["connection","generation_zh","generation_en"].some(kind => { const item=latest.get(kind); return !item || item.status!=="passed" || !item.usage_verified || (kind!=="connection"&&!item.json_valid); })) throw new ApiFailure(409,"MODEL_TESTS_REQUIRED","启用前需在当前配置版本上通过连接、中英文生成及成本校验。");
  const runtime = await env.DB.prepare("SELECT active_config_id,active_version,previous_config_id,previous_version,previous_is_legacy FROM ai_provider_runtime WHERE id=1").first<any>();
  const before = runtime ? { active: runtime.active_config_id ? { id: runtime.active_config_id, version: runtime.active_version } : null, previous: runtime.previous_config_id ? { id: runtime.previous_config_id, version: runtime.previous_version } : runtime.previous_is_legacy ? {id:null,version:null,legacy:true}:null } : null;
  const after = { active: { id, version: row.latest_version }, previous: before?.active ?? {id:null,version:null,legacy:true} };
  const operationBody = { operationId: body.operationId, reason: body.reason, id, version: row.latest_version };
  const op = await operation(env, actor, operationBody, "ai_model_activate", id);
  await commitOperation(env, op, [env.DB.prepare("UPDATE ai_provider_runtime SET previous_config_id=active_config_id,previous_version=active_version,previous_is_legacy=CASE WHEN active_config_id IS NULL THEN 1 ELSE 0 END,active_config_id=?,active_version=?,updated_at=?,updated_by=? WHERE id=1").bind(id,row.latest_version,now,actor.user_id)], before, after);
  return response({ ok: true, active: { id, version: row.latest_version }, replayed: op.replayed },200,env,request);
}

export async function rollbackAiModel(request: Request, env: Env): Promise<Response> {
  const actor = await requireAdminSession(request, env, true), body = await jsonBody(request, 4096);
  const runtime = await env.DB.prepare("SELECT active_config_id,active_version,previous_config_id,previous_version,previous_is_legacy FROM ai_provider_runtime WHERE id=1").first<any>();
  if (!runtime) throw new ApiFailure(503,"MODEL_RUNTIME_UNAVAILABLE","模型运行配置不可用。");
  if (!runtime.previous_config_id && !runtime.previous_is_legacy) throw new ApiFailure(409,"MODEL_ROLLBACK_UNAVAILABLE","没有可回滚的模型配置。");
  const before = { active: runtime.active_config_id ? { id: runtime.active_config_id, version: runtime.active_version } : null, previous: runtime.previous_config_id ? { id: runtime.previous_config_id, version: runtime.previous_version } : runtime.previous_is_legacy ? {id:null,version:null,legacy:true}:null };
  const after = { active: before.previous, previous: before.active };
  const op = await operation(env, actor, { operationId: body.operationId, reason: body.reason, active: before.active, previous: before.previous }, "ai_model_rollback", "ai_model_runtime");
  await commitOperation(env, op, [env.DB.prepare("UPDATE ai_provider_runtime SET active_config_id=previous_config_id,active_version=previous_version,previous_config_id=active_config_id,previous_version=active_version,previous_is_legacy=CASE WHEN active_config_id IS NULL THEN 1 ELSE 0 END,updated_at=?,updated_by=? WHERE id=1").bind(nowMs(),actor.user_id)], before, after);
  return response({ ok: true, active: after.active?.id ? after.active : null, legacyFallback: after.active?.id === null || !after.active, replayed: op.replayed },200,env,request);
}

export async function setAiModelArchived(request: Request, env: Env, id: string): Promise<Response> {
  const actor = await requireAdminSession(request, env, true), body = await jsonBody(request,4096);
  if (typeof body.archived !== "boolean") throw new ApiFailure(400,"INVALID_MODEL_CONFIG","停用状态无效。");
  const row = await readConfig(env,id); if (!row) throw new ApiFailure(404,"MODEL_NOT_FOUND","模型配置不存在。");
  const runtime = await env.DB.prepare("SELECT active_config_id,previous_config_id FROM ai_provider_runtime WHERE id=1").first<any>();
  if (body.archived && [runtime?.active_config_id,runtime?.previous_config_id].includes(id)) throw new ApiFailure(409,"MODEL_IN_USE","当前或回滚模型不能停用。");
  const before={id,archived:Boolean(row.archived),version:row.latest_version}, after={...before,archived:body.archived};
  const op=await operation(env,actor,{operationId:body.operationId,reason:body.reason,id,archived:body.archived},"ai_model_archive",id);
  await commitOperation(env,op,[env.DB.prepare("UPDATE ai_provider_configs SET archived=?,updated_at=?,updated_by=? WHERE id=?").bind(body.archived?1:0,nowMs(),actor.user_id,id)],before,after);
  return response({ok:true,archived:body.archived,replayed:op.replayed},200,env,request);
}
