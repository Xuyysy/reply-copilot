# Reply Copilot v0.3 本地 API 契约

Base URL（本地）：`http://127.0.0.1:8787`。生产只允许 HTTPS。网页用 `Secure; HttpOnly; SameSite=Lax` Cookie；插件用绑定后领取的独立 Bearer 令牌。网页修改状态的请求需同源 `Origin`、`X-CSRF-Token` 和 `X-Reply-Copilot-Action`。错误统一为 `{code,message,requestId,retryAfterSeconds?}`。

| 接口 | 认证 | 说明 |
|---|---|---|
| `POST /v1/auth/request-code` | 官网 Origin | `{email}`，限流，开发模式只在终端输出验证码 |
| `POST /v1/auth/verify-code` | 官网 Origin | `{email,code}`，首次成功创建 7 天试用，设置网页 Cookie |
| `POST /v1/auth/logout` | 网页 Cookie + CSRF，或插件 Bearer | 撤销当前会话 |
| `GET /v1/auth/csrf` | 网页 Cookie | 取得当前会话的 CSRF 令牌 |
| `GET /v1/me` | Cookie 或 Bearer | `{user:{userId,email}}` |
| `GET /v1/entitlements` | Cookie 或 Bearer | `status` 为 `trial_active`、`trial_exhausted`、`trial_expired` 或 `lifetime_active`；同时返回 `trial`、`license` |
| `GET /v1/usage` | Cookie 或 Bearer | `{quota:{dailyLimit,dailyUsed,dailyRemaining,resetAt}}`；终身版为 `null` |
| `POST /v1/extension/device-code` | 插件 | `{deviceId}`，返回 10 分钟绑定码和一次性设备令牌 |
| `POST /v1/extension/approve` | 网页 Cookie + CSRF | `{deviceCode}`，用户明确确认绑定 |
| `POST /v1/extension/exchange` | 插件 | `{deviceToken}`，批准后仅兑换一次 Bearer |
| `POST /v1/ai/generate` | 插件 Bearer | `{requestId,post:{text,url},voiceProfile,recentHistory,styleStats,replyStyle,outputSchemaVersion}`，返回 `{requestId,raw,quota}` |
| `GET /v1/license/devices` | Cookie 或 Bearer | 已激活设备数量与 ID |
| `POST /v1/feedback` | 网页 Cookie + CSRF | `{message}`，每日限 5 次 |

`requestId` 必须是 UUID。同一账户和请求 ID 的内容不能变。成功结果在 10 分钟内可重放而不扣第二次额度。上游已调用但失败或状态不确定时保留消耗记录，防止无限免费重试。新的“换一个”必须用新 ID。服务端复用根目录 `prompts/prompt-builder.js`，仍由插件的 `parseAIOutput` 解析同一结构化 JSON。

生产 Worker 只信 D1 的试用、额度与许可证状态；不会接受前端 `isPaid` 字段。开发者 DeepSeek Key 只在 Worker Secret，用户自己的 Key 仅供终身版在扩展可信上下文使用。
