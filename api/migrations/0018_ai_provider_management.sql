-- Versioned provider metadata and encrypted credentials for the admin model manager.
-- The active pointer is nullable so existing installations continue using the
-- pre-existing DeepSeek environment configuration until an admin explicitly switches.
CREATE TABLE ai_provider_configs (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 80),
  latest_version INTEGER NOT NULL CHECK(latest_version > 0),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL REFERENCES users(id)
);

CREATE TABLE ai_provider_config_versions (
  config_id TEXT NOT NULL REFERENCES ai_provider_configs(id),
  version INTEGER NOT NULL CHECK(version > 0),
  provider TEXT NOT NULL CHECK(provider IN ('deepseek','qwen','gemini','openai_compatible')),
  protocol TEXT NOT NULL CHECK(protocol='openai_chat'),
  base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 8 AND 300),
  model_id TEXT NOT NULL CHECK(length(model_id) BETWEEN 1 AND 160),
  api_key_ciphertext TEXT NOT NULL CHECK(length(api_key_ciphertext) BETWEEN 40 AND 1200),
  input_rate_micro_usd_per_million INTEGER NOT NULL CHECK(input_rate_micro_usd_per_million > 0),
  output_rate_micro_usd_per_million INTEGER NOT NULL CHECK(output_rate_micro_usd_per_million > 0),
  max_output_tokens INTEGER NOT NULL CHECK(max_output_tokens BETWEEN 64 AND 8192),
  timeout_ms INTEGER NOT NULL CHECK(timeout_ms BETWEEN 3000 AND 60000),
  options_json TEXT NOT NULL CHECK(length(options_json) <= 4000),
  endpoint_addresses_json TEXT NOT NULL CHECK(length(endpoint_addresses_json) <= 2000),
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  PRIMARY KEY(config_id,version)
);

CREATE TABLE ai_provider_runtime (
  id INTEGER PRIMARY KEY CHECK(id=1),
  active_config_id TEXT,
  active_version INTEGER,
  previous_config_id TEXT,
  previous_version INTEGER,
  previous_is_legacy INTEGER NOT NULL DEFAULT 0 CHECK(previous_is_legacy IN (0,1)),
  updated_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id),
  CHECK((active_config_id IS NULL)=(active_version IS NULL)),
  CHECK((previous_config_id IS NULL)=(previous_version IS NULL)),
  FOREIGN KEY(active_config_id,active_version) REFERENCES ai_provider_config_versions(config_id,version),
  FOREIGN KEY(previous_config_id,previous_version) REFERENCES ai_provider_config_versions(config_id,version)
);
INSERT INTO ai_provider_runtime(id,updated_at) VALUES(1,0);

CREATE TABLE ai_provider_tests (
  id TEXT PRIMARY KEY,
  admin_user_id TEXT NOT NULL REFERENCES users(id),
  config_id TEXT NOT NULL,
  config_version INTEGER NOT NULL,
  test_kind TEXT NOT NULL CHECK(test_kind IN ('connection','generation_zh','generation_en')),
  status TEXT NOT NULL CHECK(status IN ('running','passed','failed')),
  error_category TEXT,
  upstream_http_status INTEGER,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  usage_verified INTEGER NOT NULL DEFAULT 0 CHECK(usage_verified IN (0,1)),
  json_valid INTEGER NOT NULL DEFAULT 0 CHECK(json_valid IN (0,1)),
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY(config_id,config_version) REFERENCES ai_provider_config_versions(config_id,version)
);
CREATE INDEX ai_provider_tests_config_idx ON ai_provider_tests(config_id,config_version,created_at DESC);
CREATE INDEX ai_provider_tests_budget_idx ON ai_provider_tests(created_at,status);

CREATE TABLE ai_provider_test_budget_days (
  budget_day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls BETWEEN 0 AND 10),
  reserved_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK(reserved_micro_usd >= 0),
  settled_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK(settled_micro_usd >= 0)
);

CREATE TABLE ai_provider_test_budget_claims (
  test_id TEXT PRIMARY KEY,
  claim_token TEXT NOT NULL UNIQUE,
  budget_day TEXT NOT NULL REFERENCES ai_provider_test_budget_days(budget_day),
  reserved_micro_usd INTEGER NOT NULL CHECK(reserved_micro_usd > 0),
  created_at INTEGER NOT NULL
);
CREATE INDEX ai_provider_test_budget_claims_day_idx ON ai_provider_test_budget_claims(budget_day);

ALTER TABLE ai_requests ADD COLUMN provider_config_id TEXT;
ALTER TABLE ai_requests ADD COLUMN provider_config_version INTEGER;
ALTER TABLE ai_usage_costs ADD COLUMN provider_config_id TEXT;
ALTER TABLE ai_usage_costs ADD COLUMN provider_config_version INTEGER;
ALTER TABLE ai_usage_costs ADD COLUMN usage_quality TEXT NOT NULL DEFAULT 'verified' CHECK(usage_quality IN ('verified','estimated'));
