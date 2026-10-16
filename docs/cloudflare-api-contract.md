# x-Reply-Helper API 契约（开发版）

网页使用 HttpOnly、Secure、SameSite=Lax Cookie；插件使用独立 Bearer 令牌。网页写请求除认证入口外均需 CSRF 标记，且 Worker 校验 `WEB_ORIGIN`。普通用户不能调用管理接口。错误响应为 `{code,message,requestId}`。

| 接口 | 功能 |
|---|---|
| `POST /v1/auth/register` | 用户名、邮箱、密码、Turnstile，发送注册邮件 |
| `POST /v1/auth/verify-registration` | 邮箱验证码验证后建账户并一次性赠送额度 |
| `POST /v1/auth/login` | 用户名或邮箱加密码登录 |
| `POST /v1/auth/request-password-reset`、`POST /v1/auth/reset-password` | 邮件找回密码；重置后撤销旧会话 |
| `GET /v1/me`、`GET /v1/usage`、`GET /v1/activity` | 账户、免费/付费/总余额、流水与订单 |
| `POST /v1/extension/device-code`、`/approve`、`/exchange` | 插件短码绑定与独立会话 |
| `POST /v1/ai/generate` | 插件 Hosted AI；同一 `requestId` 幂等，成功消耗 1 次，确认失败返还 |
| `GET /v1/packages` | 服务端当前上架套餐与支付开放状态 |
| `POST /v1/orders` | 仅本地开发可保存套餐价格快照；staging/production 支付未开放时拒绝创建新订单 |
| `GET /v1/admin/dashboard`、`/users`、`/packages`、`/orders`、`/settings`、`/ledger` | 管理数据，需管理员会话和独立安全口令 |
| `POST /v1/admin/users/{id}/status`、`/credits` | 冻结/解冻与有原因、有确认的额度调整 |
| `POST /v1/admin/packages/{id}`、`/settings/{key}` | 未来套餐与系统设置修改，记录审计 |
| `POST /v1/dev/orders/{id}/settle` | 仅本地测试；验证金额、币种与事件去重后模拟到账 |

余额字段为 `{freeRemaining,paidRemaining,totalRemaining}`。服务端 D1 是唯一权威；插件缓存只用于展示。套餐价格以订单创建时的服务端快照为准。`paymentAvailable:false` 表示没有真实收款通道。

`trials`、`daily_usage`、`licenses` 和旧邮件验证码表为迁移保留记录，不再决定正式 AI 生成授权。插件中的自带 Key 路由已移除；本地开发使用 Worker Mock AI。
