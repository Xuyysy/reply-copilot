// Shared SQL for runtime and isolated workerd plan/row tests.
export const COST_HISTORY_SQL = `WITH grouped AS (
      SELECT u.provider_config_id,u.provider_config_version,u.model,
        COUNT(*) monthRequests,SUM(u.input_tokens) monthInput,
        SUM(u.output_tokens) monthOutput,SUM(u.estimated_cost_micro_usd) monthCost,
        SUM(CASE WHEN u.created_at>=?2 THEN 1 ELSE 0 END) todayRequests,
        SUM(CASE WHEN u.created_at>=?3 THEN u.input_tokens ELSE 0 END) todayInput,
        SUM(CASE WHEN u.created_at>=?4 THEN u.output_tokens ELSE 0 END) todayOutput,
        SUM(CASE WHEN u.created_at>=?5 THEN u.estimated_cost_micro_usd ELSE 0 END) todayCost
      FROM ai_usage_costs u WHERE u.created_at>=?1
      GROUP BY u.provider_config_id,u.provider_config_version,u.model
    ), attributed AS (
      SELECT CASE WHEN u.provider_config_id IS NOT NULL THEN COALESCE(v.provider,'unknown')
          WHEN u.model='mock' THEN 'mock' ELSE 'deepseek' END providerCode,
        COALESCE(v.model_id,u.model) model,
        CASE WHEN u.provider_config_id IS NULL THEN CASE WHEN u.model='mock' THEN 'mock' ELSE 'legacy' END
          WHEN v.config_id IS NULL THEN 'unresolved' ELSE 'managed' END configurationSource,
        u.monthRequests,u.monthInput,u.monthOutput,u.monthCost,
        u.todayRequests,u.todayInput,u.todayOutput,u.todayCost
      FROM grouped u LEFT JOIN ai_provider_config_versions v
        ON v.config_id=u.provider_config_id AND v.version=u.provider_config_version
    ) SELECT providerCode,model,configurationSource,SUM(monthRequests) monthRequests,
      SUM(monthInput) monthInput,SUM(monthOutput) monthOutput,SUM(monthCost) monthCost,
      SUM(todayRequests) todayRequests,SUM(todayInput) todayInput,
      SUM(todayOutput) todayOutput,SUM(todayCost) todayCost
    FROM attributed GROUP BY providerCode,model,configurationSource
    ORDER BY monthCost DESC,providerCode,model,configurationSource`;
