import { EFFECTIVE_PROVIDER_SQL } from "./ai-model-provider.js";
import type { Env } from "./types";
import { DEEPSEEK_MODEL } from "./ai";

const providerNames: Record<string, string> = {
  deepseek: "DeepSeek", qwen: "Qwen", gemini: "Gemini", siliconflow: "SiliconFlow",
  openai_compatible: "OpenAI-compatible", mock: "Mock AI", unknown: "Unknown",
};
type ActiveModel = {
  active_config_id: string | null; active_version: number | null;
  provider: string | null; model_id: string | null; archived: number | null; key_present: number;
};
type CostRow = {
  providerCode: string; model: string; configurationSource: string;
  todayRequests: number; todayInput: number; todayOutput: number; todayCost: number;
  monthRequests: number; monthInput: number; monthOutput: number; monthCost: number;
};

/** Read metadata only: never load/decrypt provider credentials for reporting. */
export async function aiCostDetails(env: Env, mode: string, dayStart: number, monthStart: number) {
  const [active, costs] = await Promise.all([
    env.DB.prepare(`SELECT r.active_config_id,r.active_version,c.archived,${EFFECTIVE_PROVIDER_SQL} provider,v.model_id,
        CASE WHEN length(v.api_key_ciphertext)>0 THEN 1 ELSE 0 END key_present
      FROM ai_provider_runtime r LEFT JOIN ai_provider_configs c ON c.id=r.active_config_id
      LEFT JOIN ai_provider_config_versions v ON v.config_id=r.active_config_id AND v.version=r.active_version
      WHERE r.id=1`).first<ActiveModel>(),
    env.DB.prepare(`WITH attributed AS (
      SELECT CASE WHEN u.provider_config_id IS NOT NULL THEN COALESCE(${EFFECTIVE_PROVIDER_SQL},'unknown')
          WHEN u.model='mock' THEN 'mock' ELSE 'deepseek' END providerCode,
        COALESCE(v.model_id,u.model) model,
        CASE WHEN u.provider_config_id IS NULL THEN CASE WHEN u.model='mock' THEN 'mock' ELSE 'legacy' END
          WHEN v.config_id IS NULL THEN 'unresolved' ELSE 'managed' END configurationSource,
        u.created_at,u.input_tokens,u.output_tokens,u.estimated_cost_micro_usd
      FROM ai_usage_costs u LEFT JOIN ai_provider_config_versions v
        ON v.config_id=u.provider_config_id AND v.version=u.provider_config_version
      WHERE u.created_at>=?
    ) SELECT providerCode,model,configurationSource,COUNT(*) monthRequests,
      SUM(input_tokens) monthInput,SUM(output_tokens) monthOutput,SUM(estimated_cost_micro_usd) monthCost,
      SUM(CASE WHEN created_at>=? THEN 1 ELSE 0 END) todayRequests,
      SUM(CASE WHEN created_at>=? THEN input_tokens ELSE 0 END) todayInput,
      SUM(CASE WHEN created_at>=? THEN output_tokens ELSE 0 END) todayOutput,
      SUM(CASE WHEN created_at>=? THEN estimated_cost_micro_usd ELSE 0 END) todayCost
    FROM attributed GROUP BY providerCode,model,configurationSource
    ORDER BY monthCost DESC,providerCode,model,configurationSource`).bind(monthStart,dayStart,dayStart,dayStart,dayStart).all<CostRow>(),
  ]);
  // A configured active pointer must never silently report the legacy key.
  const service = mode === "mock"
    ? { mode, provider: "Mock AI", model: "mock", configurationSource: "mock", configVersion: null, keyConfigured: false }
    : active?.active_config_id
      ? { mode, provider: providerNames[active.provider || "unknown"] || "Unknown", model: active.model_id || "—",
          configurationSource: "managed", configVersion: active.active_version,
          keyConfigured: Boolean(active.key_present && !active.archived && env.AI_CONFIG_ENCRYPTION_KEY) }
      : { mode, provider: mode === "unconfigured" ? "—" : "DeepSeek", model: mode === "unconfigured" ? "—" : DEEPSEEK_MODEL,
          configurationSource: "legacy", configVersion: null, keyConfigured: Boolean(env.DEEPSEEK_API_KEY) };
  const sumCosts=(period:"today"|"month")=>costs.results.reduce((sum,row)=>({
    inputTokens:sum.inputTokens+Number(period==="today"?row.todayInput:row.monthInput),
    outputTokens:sum.outputTokens+Number(period==="today"?row.todayOutput:row.monthOutput),
    costMicroUsd:sum.costMicroUsd+Number(period==="today"?row.todayCost:row.monthCost),
  }),{inputTokens:0,outputTokens:0,costMicroUsd:0});
  return {
    cost:sumCosts("month"),todayCost:sumCosts("today"),service,
    costByModel: costs.results.map(row => ({
      provider: providerNames[row.providerCode] || "Unknown", model: row.model, configurationSource: row.configurationSource,
      today: { requests: row.todayRequests, inputTokens: row.todayInput, outputTokens: row.todayOutput, costMicroUsd: row.todayCost },
      month: { requests: row.monthRequests, inputTokens: row.monthInput, outputTokens: row.monthOutput, costMicroUsd: row.monthCost },
    })),
  };
}
