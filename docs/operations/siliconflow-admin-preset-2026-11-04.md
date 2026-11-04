# SiliconFlow dedicated model preset (implementation notes)

Scope: a dedicated provider choice in the existing X Reply Helper model admin. Based on deployed PR #12 source `fe7ac405e69623455405bd9bc07eb883a807c4c5`. No production deployment, D1 access, key creation, or active-model changes.

## Management UI
- Choose **SiliconFlow**. Choose China (`https://api.siliconflow.cn/v1`) or Global (`https://api.siliconflow.com/v1`); model ID deliberately blank: copy the full ID from the SiliconFlow model marketplace.
- Default thinking: **disabled** for speed. Choose **provider default** when an individual model does not support the `enable_thinking` parameter. JSON Mode defaults **on**, can be disabled for unsupported models. All changes are opt-in per model config version.
- The current financial budget guard requires positive input and output rates **in USD per million tokens**. Enter actual model rates where available; for zero-priced/free-tier models this release still requires a small conservative positive estimate. Internal usage cost becomes an estimate rather than the actual bill. A complete zero-cost accounting redesign is out of scope to protect paid users.
- Existing admin test connection, Chinese/English structure tests, usage check, confirmation, activation, rollback, encrypted API key, and audit rules are unchanged.

## Backend
- Dedicated `siliconflow` provider is restricted to exactly `api.siliconflow.cn/v1` or `api.siliconflow.com/v1`, HTTPS, no URL credentials/query/private IPs. It uses the existing A+AAAA DNS safety checks and HTTPS Bearer token.
- Only documented Chat Completions fields are sent: `response_format: {type:"json_object"}` when enabled; `enable_thinking` only when the operator explicitly selected enabled/disabled. Default model behavior omits it entirely.
- Dashboard and historical cost attribution distinguish SiliconFlow China and SiliconFlow Global. Old China versions without region metadata remain China.
- No extra D1 query or migration, no changes to payment/quota/credit handling.

## Safety
- Don't place a real API key in GitHub, test snapshots, screenshots or chat.
- Before production activation: test connection, Chinese/English three-reply JSON output and verified token usage; confirm latency and suitability for user data and commercial use.
- Do not deploy with old production.wrangler.json vars; there is known live configuration drift. Preserve current bindings, secrets and MK99 payment flags.
- This branch is for review and sandbox tests; Staging rollout is authorized; Production still requires separate explicit authorization.

Official docs: https://docs.siliconflow.cn/docs/api/chat-completions-post and https://docs.siliconflow.cn/docs/userguide/guides/json-mode

## Staging validation / storage compatibility (2026-11-04)

The original candidate failed its two isolated SiliconFlow save tests: migration
0018's existing provider CHECK only allows DeepSeek/Qwen/Gemini/OpenAI-compatible.
The fix does not alter that migration or require any remote SQL. SiliconFlow is
stored as `provider=openai_compatible` plus the server-owned versioned
`options.providerPreset=siliconflow`. The admin list, active/previous pointers,
generation resolver and existing cost joins recover the logical provider.
The dedicated HTTPS/host/path validation still runs before every upstream call;
generic custom submissions cannot supply this reserved preset marker. Existing
configs are not rewritten. API keys retain the existing AES-GCM/AAD versioning.

Local tests use synthetic credentials and isolated SQLite/workerd only. They
cover connection JSON, full Chinese/English reply contracts, token cost, activation
gates, rollback, new versions retaining encrypted keys, released-client parsing,
replay/ACK single debit, private DNS and redirect rejection. Browser tests render
real React controls with mock callbacks; their screenshot is not evidence of an
authenticated live admin test.

Staging rollout must be a selective integration onto the live Staging source
85b3b7803ef5b5f536247b03455a9d30b882ad6a (Worker) / 0ae9d25d81033551b832051906922bb3b6860dff
(Pages), not the whole Production-based PR tree. In particular retain Staging's
current admin test limits, performance diagnostics, prompt, signup claims and
ACK statistics. No remote D1 statements, model save/activation, live upstream
calls, payment operations or Production changes are part of this validation.

Rollback to the pre-release Worker/Pages without restoring D1. No SiliconFlow
configs are created online in this phase. If operators later activate the preset,
switch back to an existing supported provider before rolling back to code that
does not understand `providerPreset` (otherwise its generic adapter omits vendor
options); existing immutable config versions and audit records remain intact.

## Dual-region supplement

- Region belongs to an immutable versioned configuration. Changing region in the
  form starts a separate record and clears API key and input/output rates. The
  server rejects changing an existing SiliconFlow record to the other region,
  including attempts to reuse ciphertext. Separate records keep separate keys.
  A wrong-region key receives the upstream authentication error; no alternate
  endpoint retry or automatic routing is performed.
- China list prices are CNY. Operators must convert to USD/1M tokens using their
  verified exchange rate (or a conservative USD estimate), then explicitly
  confirm conversion. Global list prices are USD. Both save `rateCurrency=USD`;
  the server rejects CNY submissions and unconfirmed China rates. No exchange
  rate is fabricated, no ledger currency or existing record is changed. Numeric
  values cannot independently prove an operator's exchange calculation.
- Both regions retain model ID, timeout, max tokens, JSON on/off and thinking
  enabled/disabled/omitted. Unsupported parameters must be disabled/omitted by
  the operator after checking the model's documented capabilities.
- References: https://docs.siliconflow.com/en/api-reference/chat-completions/chat-completions
  and https://docs.siliconflow.com/en/userguide/quickstart .
- Mock regressions exercise both-region bilingual full response contracts,
  activation/rollback, encrypted-key isolation, 12 request-option combinations,
  unsafe hosts/DNS/redirects, existing providers and released-client ACK/replay.
  Screenshots render the real React panel in an isolated mock harness; they do
  not represent authenticated live saves or real paid upstream calls.
