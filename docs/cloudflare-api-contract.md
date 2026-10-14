# Reply Copilot v0.2 客户端与未来 Cloudflare 服务契约

此文档只定义接口。本版本没有部署的官网、Worker、D1、支付或真实授权。正式构建的 `websiteUrl` 和 `hostedApiUrl` 为空；接入时需配置 HTTPS 域名并加入精确的 Chrome host permission。开发版模拟状态不是服务端授权。

## 通用规则

- Base URL：将来由 `config/runtime.js` 的 `hostedApiUrl` 指定，必须为 HTTPS。
- 认证：`Authorization: Bearer <extension session token>`。令牌由未来官网与扩展的受信回调流程取得，只存可信扩展存储。网页不能用普通 `postMessage` 改授权状态。
- 响应：JSON；错误 `{ "code": "AUTH_REQUIRED", "message": "...", "requestId": "..." }`。不得在错误里回显令牌或 DeepSeek Key。
- 客户端请求超时：30 秒。`POST /v1/ai/generate` 的 `requestId` 为 UUID，也是幂等键；相同用户和 requestId 必须只扣一次额度、返回同一次结果。重新生成必须用新 requestId。
- `lastVerifiedAt` 是客户端成功收到服务端状态后的时间，只用于显示与短时缓存；不能替代服务端校验。
- 服务端按北京时间计算 7 天试用和每天最多 30 次额度，北京时间 00:00 重置。一次生成三种风格算一次；切换已生成候选不扣次数。额度扣减必须在服务端原子执行。
- 终身版只在服务端返回有效许可证时开放 BYOK；用户自己的 DeepSeek Key 不发送到本服务。

## GET /v1/me

请求：Bearer 令牌，无请求体。响应：`{ "user": { "userId": "...", "email": "..." } }`。未登录返回 `AUTH_REQUIRED` (401)。

## GET /v1/entitlements

请求：Bearer 令牌。响应示例：`{ "status": "trial_active", "entitlement": { "entitlementStatus": "active" }, "trial": { "startedAt": "ISO-8601", "expiresAt": "ISO-8601" }, "license": null }`。状态为 `trial_active | trial_exhausted | trial_expired | lifetime_active`。终身授权时 `license` 包含 `licenseType`, `licenseStatus`, `maxDevices`, `activatedDevices`。客户端不得根据本地字段伪造状态。

## GET /v1/usage

请求：Bearer 令牌。响应：`{ "quota": { "dailyLimit": 30, "dailyUsed": 12, "dailyRemaining": 18, "resetAt": "ISO-8601" } }`。所有字段来自服务端；终身版可返回 `quota: null`。

## POST /v1/ai/generate

请求：Bearer 令牌，JSON：`{ "requestId": "UUID", "prompts": { "system": "...", "user": "..." }, "outputSchemaVersion": 1 }`。请求头也可加 `Idempotency-Key: <requestId>`。仅有效试用用户可调用。响应：`{ "requestId": "UUID", "raw": "{...ReplyEngine 所需的结构化 JSON...}", "quota": { "dailyLimit": 30, "dailyUsed": 13, "dailyRemaining": 17, "resetAt": "ISO-8601" } }`。`raw` 与现有 `DeepSeekClient.generateReplies` 输出一致，仍由唯一的 `ReplyEngine` 解析。服务端必须控制额度、并发和上游 Key；不能信任客户端计数。响应中不应返回开发者 Key。

## GET /v1/license/devices

请求：Bearer 令牌。响应：`{ "licenseStatus": "active", "maxDevices": 2, "devices": [{ "deviceId": "...", "activatedAt": "ISO-8601" }] }`。本版本只定义读取契约，不实现解绑。

## 错误码

`AUTH_REQUIRED` (401)、`TRIAL_EXPIRED` (403)、`QUOTA_EXCEEDED` (429)、`LICENSE_INVALID` (403)、`LICENSE_REVOKED` (403)、`AI_PROVIDER_UNAVAILABLE` (503)、`SERVER_UNAVAILABLE` (503)、`NETWORK_ERROR`（客户端网络故障）。授权服务不可用时客户端显示 `auth_unavailable`，保留本地设置，不视为许可证撤销。服务端可返回 `retryAfterSeconds`。
