# Staging admin AI model management

This feature is isolated to the `codex/admin-ai-model-management` branch and Staging Worker/D1/Pages. It does not alter Production configuration or the Chrome extension package.

## Runtime behavior

- Until an administrator activates a tested configuration, generation continues to use the existing `DEEPSEEK_API_KEY` path and existing pricing settings.
- Saved provider versions are immutable. Editing creates a new encrypted-key version. New generation requests pin the chosen config ID/version in `ai_requests`; retries and delivery acknowledgements use that original request record.
- Supported first-release protocol is OpenAI-compatible Chat Completions. Provider presets only enable provider-specific options implemented by the adapter. Other native protocols are rejected.
- Output passes through the existing `parseAIOutput` contract and an additional uniqueness check. Truncated responses, invalid format, missing token usage and unverified cost fail closed. No cross-provider retry occurs.
- Admin tests are separate from user generation credits. They are limited to 10 calls/day and a $0.05/day test budget; any test whose estimated reservation exceeds the remaining test budget is refused. Test spend is also reserved/settled against the existing daily AI budget. A request with an unknown outcome remains conservatively charged against its reservation.

## Secret and data handling

`AI_CONFIG_ENCRYPTION_KEY` is a base64-encoded 32-byte independent Worker Secret. It is not stored in D1 or in this repository. API keys are encrypted with AES-GCM, random IVs and config/version-bound associated data. The key is never returned to the browser. Test prompts and provider responses are not persisted; only safe status, HTTP category, latency, token counts and cost are retained. Audit snapshots contain configuration metadata and a keyed API-key fingerprint, never the key or ciphertext.

Do not rotate `AI_CONFIG_ENCRYPTION_KEY` after model credentials have been saved unless a controlled re-encryption procedure is ready; existing ciphertext becomes undecryptable. A Staging-only key can be created without displaying it in terminal output by piping it directly to Wrangler:

```sh
openssl rand -base64 32 | npx wrangler secret put AI_CONFIG_ENCRYPTION_KEY --env staging --config api/wrangler.jsonc
```

Run this only if the Staging binding list confirms the secret name is absent. Never use `--env production` for this feature.

## Staging rollout

1. Verify `api/wrangler.jsonc` Staging worker name and D1 UUID are `reply-copilot-api-staging` and `cd44bb44-b525-42c4-b286-2cc84dae7fdb`.
2. Inspect the Staging D1 migration list. Apply only `0018_ai_provider_management.sql` if `0018` is not already recorded:

   ```sh
   cd api
   npx wrangler d1 migrations list reply-copilot-staging --remote --env staging --config wrangler.jsonc
   npx wrangler d1 migrations apply reply-copilot-staging --remote --env staging --config wrangler.jsonc
   ```

3. Configure the Staging encryption Secret if absent using the command above. Do not inspect or export any other Worker Secret values.
4. Build/deploy the Worker with `--env staging --keep-vars --config api/wrangler.jsonc`; verify its D1 binding and that all Staging safety/payment values remain unchanged.
5. Build Pages with `PUBLIC_API_BASE_URL=https://api-staging.x-reply-helper.top` and deploy to the existing `x-reply-helper-staging` project.

## Manual Staging acceptance

Use the existing Staging administrator account at `https://staging.x-reply-helper.top/admin/` and select **AI Models**.

1. Add one provider configuration. Use the exact vendor-documented base URL and model ID. For custom OpenAI-compatible endpoints, confirm the risk checkbox and use a trusted HTTPS provider you control.
2. Save, verify that it remains inactive, and verify the API key field is blank when the configuration is re-opened. Key values are never re-shown.
3. Run connection, Chinese output and English output tests. Each call contacts the configured model and consumes the bounded test budget; no user generation credit is consumed.
4. Confirm token counts, cost, JSON validity and safe error category are visible without response content or credentials.
5. Activate only after all three current-version tests pass and then verify one normal Staging generation. Check `ai_requests.provider_config_id/version` and matching `ai_usage_costs` rows via a read-only admin query if needed.
6. Use **Rollback previous** to return new requests to the prior configuration. In-flight requests stay pinned to the version selected when their reservation was created.
7. Never paste credentials into chat, issue descriptions, logs or source files. Do not test by publishing an X reply.

## AI cost dashboard

- **AI cost** reads the active configuration/version pointer and reports that version's provider, model and credential readiness. Reporting does not load or decrypt API keys. With no managed pointer, the existing Legacy DeepSeek environment configuration remains the fallback.
- Today/month token and cost totals continue to include all model usage. The provider/model tables join each usage record to its original configuration version, never the current or latest version. Legacy records remain labeled **Legacy DeepSeek**. An unresolved managed version is labeled explicitly rather than reassigned to the active provider.
- Request counts in these tables count cost-bearing generation records, including upstream failures with recorded costs. The daily budget remains authoritative for all providers, administrator tests and unsettled reservations; reservations are not included in settled model rows. All reporting periods use UTC.
- Activation and rollback refresh the Dashboard; entering **AI cost** or using its Refresh button fetches current data. Switching models does not clear costs or recalculate historical costs at new token rates.
- To accept this change, inspect **Qwen / qwen3.7-flash**, its configured key status, and both cost tables in Chinese/English. If switching or rolling back already-tested models, confirm the active label updates while historical totals and provider rows remain. This does not require a new AI generation.

## Provider constraints

- DeepSeek uses its documented JSON mode and `thinking.type=disabled` behavior.
- Qwen uses the OpenAI-compatible endpoint and only includes JSON/thinking flags explicitly selected for the model; the UI/server reject the incompatible “thinking enabled + JSON mode” combination.
- Gemini uses Google's documented OpenAI-compatible Chat Completions route, without DeepSeek or guessed JSON-mode fields. The existing strict parser remains the format gate.
- Custom providers are restricted to OpenAI-compatible Chat Completions, HTTPS on port 443, public DNS addresses, no redirects, no IP literals, credentials, query strings or local/private destinations. Endpoint DNS is rechecked before credential-bearing calls and compared with the saved public address set. Providers receive the user prompt context and API key by design; choose only a provider trusted to process that data.

Provider behavior is based on current official docs: [DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/), [Alibaba Cloud Qwen OpenAI-compatible Chat Completions](https://help.aliyun.com/en/model-studio/qwen-api-via-openai-chat-completions), and [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai/).
