# Cloudflare 与外部服务配置（尚未部署）

当前 `api/wrangler.jsonc` 已有独立 staging / production 模板，远端 D1 ID、Origin 和插件 ID 仍是占位值。只执行过本地迁移；没有检查或改动任何正式 D1。完整的当前步骤与验收清单见 [预发布联调手册](staging-runbook.md)。部署、DNS、Secret 和真实 AI 调用需要运营者另行确认。

## 迁移顺序与备份

1. 对既有 D1 先做备份或导出，记录数据库 ID 与当前迁移版本；在独立预发布 D1 先验证。
2. `0002_credits.sql` 只增加用户名、密码、状态、角色及额度、流水、套餐、订单、管理、成本表，并为现有**开发测试账户**补发 200 次。`0003_adjustment_guard.sql` 增加人工调整的并发标记。旧表不删。
3. 本地运行 `cd api && npm run migrate:local`。Wrangler 迁移以文件名记录版本，重复运行只应用未执行的迁移。生产执行 `--remote` 前必须先核对真实 D1 备份、目标 ID 和迁移记录，并获得部署确认。
4. 回滚方式是恢复备份到隔离库并切回旧 Worker；这些迁移是加法修改，**不提供盲目删除新表的回滚脚本**，以免误删新订单或流水。

## Resend

1. 在 Resend 创建账户、验证发送域名，按其后台给出的 DNS 记录配置并等待验证；检查发送额度与适用费用，不需要购买付费套餐。
2. 用已验证域名的发件地址配置 `MAIL_FROM`；将 Resend API Key 作为 Worker Secret `MAIL_API_KEY` 配置。不要写入 Git、Pages 公开变量或普通 `vars`。
3. 注册与找回密码邮件均有中文 HTML 和纯文本版本。每个邮箱至少间隔 60 秒，同邮箱与来源有小时限流；验证码 10 分钟有效、最多尝试 5 次、使用一次。生产邮件发送失败返回明确错误，且清除未发送的待验证记录。

## Turnstile

1. 在 Cloudflare Turnstile 创建官网 Widget，绑定正式官网域名。
2. 将公开 sitekey 配置为网站构建变量 `PUBLIC_TURNSTILE_SITE_KEY`；将私密 secret 配置为 Worker Secret `TURNSTILE_SECRET_KEY`。Worker 调用 Siteverify 并核对生产 hostname。
3. 本地开发使用 Cloudflare 官方测试 sitekey `1x00000000000000000000AA` 和测试 secret `1x0000000000000000000000000000000AA`。生产 Worker 拒绝测试 secret；缺少真实密钥时注册关闭。

## Worker 与 Pages

- 将真实 D1 database ID、官网/API HTTPS Origin、`EXTENSION_ORIGIN` 精确写入对应环境配置。官网/API 建议在同一主域下以便 Cookie 安全属性按设计工作。
- Worker Secrets：`AUTH_HASH_SECRET`、`PASSWORD_PEPPER`、`TURNSTILE_SECRET_KEY`、`MAIL_API_KEY`、`MAIL_FROM`。`DEEPSEEK_API_KEY` 仅在明确批准真实 AI 联调或生产调用后设置。Secret 不可进入扩展、Git 或日志。管理员复用官网登录 Cookie，无独立安全口令或动态验证码。
- 配置 `SITE_DAILY_CAP`、DeepSeek 每百万输入/输出 Token 的当前美元费率 `DEEPSEEK_INPUT_USD_PER_MILLION`、`DEEPSEEK_OUTPUT_USD_PER_MILLION`，并在后台确认全站成本上限。成本费率会变动，必须按服务商当前报价核对。站点请求上限提供独立熔断；当前成本估算不是账单结算依据。
- Pages 项目使用现有 `web` 目录，构建 `npm run build`，输出 `dist`，设置 `PUBLIC_API_BASE_URL` 为正式 HTTPS API Origin。首次访问默认简体中文。
- 生产插件使用真实官网、API URL 与扩展 ID 构建；复核 `debugger` 权限与 X 规则，手测手动发送和复制备用路径。生产构建不提供本地模拟授权或 BYOK 绕过额度。
- 管理员必须经受控流程赋予 D1 `role='admin'`，且账户状态正常、邮箱已验证。普通注册不能指定管理员角色。生产 `ADMIN_PORTAL_ENABLED=0` 保持关闭；完成独立安全验收并获得授权后才可开放。原有 MFA 表不删除，但不再用于鉴权。

## 支付状态

当前已实现服务端 CNY 套餐订单、仅 loopback 可用的本地模拟支付、小豆 RSA2 请求签名/响应验签/Webhook 验签与查单补偿，以及退款状态和额度冲销账本。真实支付开关默认关闭，生产页面不能新建真实订单，Worker 不接受真实小豆回调。套餐美元参考价为 $1.49/$2.99/$4.99，对应固定人民币 990/1990/3290 分；已有历史订单快照和用户余额不被改写。真实启用前仍需商户凭证、平台 Sandbox/受控联调、金额状态核验、退款与争议流程、商户资格和税务/法律审查。

参考：[Cloudflare Turnstile 验证](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)、[Turnstile 测试密钥](https://developers.cloudflare.com/turnstile/troubleshooting/testing/)、[Workers Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)、[Resend API](https://resend.com/docs/api-reference/emails/send-email)。
