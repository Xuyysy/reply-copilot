# SiliconFlow dedicated model preset (implementation notes)

Scope: a dedicated provider choice in the existing X Reply Helper model admin. Based on deployed PR #12 source `fe7ac405e69623455405bd9bc07eb883a807c4c5`. No production deployment, D1 access, key creation, or active-model changes.

## Management UI
- Choose **SiliconFlow**. Base URL defaults to `https://api.siliconflow.cn/v1`, model ID deliberately blank: copy the full ID from the SiliconFlow model marketplace.
- Default thinking: **disabled** for speed. Choose **provider default** when an individual model does not support the `enable_thinking` parameter. JSON Mode defaults **on**, can be disabled for unsupported models. All changes are opt-in per model config version.
- The current financial budget guard requires positive input and output rates **in USD per million tokens**. Enter actual model rates where available; for zero-priced/free-tier models this release still requires a small conservative positive estimate. Internal usage cost becomes an estimate rather than the actual bill. A complete zero-cost accounting redesign is out of scope to protect paid users.
- Existing admin test connection, Chinese/English structure tests, usage check, confirmation, activation, rollback, encrypted API key, and audit rules are unchanged.

## Backend
- Dedicated `siliconflow` provider is restricted to `api.siliconflow.cn/v1`, HTTPS, no URL credentials/query/private IPs. It uses the existing A+AAAA DNS safety checks and HTTPS Bearer token.
- Only documented Chat Completions fields are sent: `response_format: {type:"json_object"}` when enabled; `enable_thinking` only when the operator explicitly selected enabled/disabled. Default model behavior omits it entirely.
- Dashboard labels the provider SiliconFlow rather than Unknown.
- No extra D1 query or migration, no changes to payment/quota/credit handling.

## Safety
- Don't place a real API key in GitHub, test snapshots, screenshots or chat.
- Before production activation: test connection, Chinese/English three-reply JSON output and verified token usage; confirm latency and suitability for user data and commercial use.
- Do not deploy with old production.wrangler.json vars; there is known live configuration drift. Preserve current bindings, secrets and MK99 payment flags.
- This branch is for review and sandbox tests; release requires a separate explicit authorization.

Official docs: https://docs.siliconflow.cn/docs/api/chat-completions-post and https://docs.siliconflow.cn/docs/userguide/guides/json-mode
