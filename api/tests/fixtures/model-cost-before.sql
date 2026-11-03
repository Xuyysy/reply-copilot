WITH attributed AS (
      SELECT CASE WHEN u.provider_config_id IS NOT NULL THEN COALESCE(v.provider,'unknown')
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
    ORDER BY monthCost DESC,providerCode,model,configurationSource
