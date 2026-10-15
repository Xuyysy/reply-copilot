# Reply Copilot 预发布联调手册

本手册只针对现有仓库和草稿 PR #2。**当前没有创建或修改任何远端 Cloudflare 资源、执行远端迁移、部署网站或 API、写入真实 Secret、调用真实 DeepSeek。** 下列远端步骤须经仓库所有者明确确认后执行。不要合并 PR #2；它以 `codex/v0.3-platform` 为基线，先处理上游 PR #1 的合并关系。

## 环境拓扑与隔离

| 环境 | Worker | D1 | 网站/API | AI |
| --- | --- | --- | --- | --- |
| 本地 | `wrangler dev --local` | `reply-copilot-local` 本地文件 | 127.0.0.1 | 模拟 |
| Staging | `reply-copilot-api-staging` | 独立 `reply-copilot-staging` | 同一注册域下的两个 HTTPS 子域 | 默认模拟 |
| Production | `reply-copilot-api-production` | 独立 `reply-copilot-production` | 另一组 HTTPS Origin | 仅正式配置后真实调用 |

`api/wrangler.jsonc` 的 staging / production D1 UUID、网站域名、API 域名和插件 ID 仍是**不能部署的占位值**。`npm run check:staging` / `npm run check:production` 在占位值未替换前故意失败。不要把 staging D1 指向生产 D1，也不要把生产网站构建指向 staging API。Wrangler 各环境的 `vars`、D1 绑定和 Secret **不会继承**；须分别设置。[Cloudflare 环境文档](https://developers.cloudflare.com/workers/wrangler/environments/)

官网和 API 应使用相同站点的 HTTPS 子域，例如 `staging.<你的域名>` 与 `api-staging.<你的域名>`。网页登录 Cookie 是 `HttpOnly; Secure; SameSite=Lax`，跨不同注册域的 Pages/Workers 默认地址可能使浏览器拒绝携带 Cookie。插件使用独立 Bearer Token，`EXTENSION_ORIGIN` 必须是安装后的准确 `chrome-extension://<32 位 ID>`。Staging 不接受任意扩展 Origin。

## 取得授权后的远端操作顺序

1. **先只读核对** Cloudflare 账户、现有 Pages/Worker、D1 列表、域名、DNS 与迁移历史。确认资源归属，记录现有正式 D1 ID。若正式 D1 已存在，先备份。绝不运行没有 `--env` 的远端命令。
2. 获得创建资源授权后，创建**单独**的 staging D1：在 `api` 目录运行 `npx wrangler d1 create reply-copilot-staging`，复制返回的数据库 ID，仅填入 `env.staging.d1_databases[0].database_id`。生产 ID 留待单独核对；不要新建第二个生产库以覆盖既有库。[D1 配置](https://developers.cloudflare.com/workers/wrangler/configuration/#d1-databases)
3. 选定实际 HTTPS 域名后，替换 staging 的 `WEB_ORIGIN`、`API_ORIGIN`；安装 staging 构建版插件并复制实际插件 ID 填入 `EXTENSION_ORIGIN`。运行 `cd api && npm run check:staging`。核对两个 Origin 属于同一站点。
4. 获得**远端迁移**授权后，先运行 `npx wrangler d1 migrations list DB --env staging --remote` 复核目标数据库和待执行文件；再运行 `npx wrangler d1 migrations apply DB --env staging --remote`。应按 `0001`、`0002`、`0003`、`0004` 顺序。`0004` 为进行中的 AI 调用增设预算预留、管理员 MFA 表，并回填已有成本。只对 staging 执行。生产迁移需要另行审批。[D1 迁移文档](https://developers.cloudflare.com/d1/reference/migrations/)
5. 配置 staging 专用 Secret、Resend 和 Turnstile（如下），核对费用及发件额度。获得**添加真实 Secret**和**部署公开服务**授权后，再部署 staging Worker 与现有网站的 staging 构建/分支；不要使用生产 Secret。上线前再次确认 `AI_MODE=mock`、`ADMIN_PORTAL_ENABLED=0`，网站 `PUBLIC_API_BASE_URL` 指向 staging API。
6. 完成基础注册/绑定验收后，若需测试管理后台，先在 staging D1 **受控**地给已验证的测试账户赋 `role='admin'`，配置独立管理员 Secret，在测试窗口将 staging `ADMIN_PORTAL_ENABLED` 改为 `1` 并部署。首次登录 `/admin` 设置验证器 TOTP，随后用动态验证码取得 15 分钟管理员会话。普通用户及未通过 MFA 的管理员请求均应为 403。生产 `ADMIN_PORTAL_ENABLED` 保持 `0`，待独立安全验收。
7. 真实 DeepSeek 只能在**再次明确授权**后开启：将 staging `AI_MODE` 从 `mock` 改为 `real-test`、设置 `REAL_DEEPSEEK_TEST_ENABLED=1`、`REAL_DEEPSEEK_TEST_USER_EMAIL=<指定测试邮箱>`、`REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD<=100000`，保持 `SITE_DAILY_CAP<=10`，并将 D1 `daily_cost_limit_micro_usd` 设为不高于该值。另提供 staging 专用 `DEEPSEEK_API_KEY` 及核实后的峰值费率。先发一条请求，检查费用后再继续。关停时撤回开关和 Key，恢复 `AI_MODE=mock`。

上面的 `wrangler deploy --env staging`、Pages 发布、远端数据库及 Secret 命令现在都**没有执行**。任何 CI 自动部署也须先关闭或确认不会触发公开发布。

## 配置清单

| 位置 | 名称 | Staging 要求 |
| --- | --- | --- |
| `api/wrangler.jsonc` vars | `ENVIRONMENT`, `AI_MODE`, `WEB_ORIGIN`, `API_ORIGIN`, `EXTENSION_ORIGIN`, `SITE_DAILY_CAP`, `ADMIN_PORTAL_ENABLED`, `DISPOSABLE_EMAIL_DOMAINS` | 各环境独立；AI 默认 `mock`，管理入口默认 `0` |
| Worker Secret | `AUTH_HASH_SECRET`, `PASSWORD_PEPPER` | staging 独立随机值，不能复用生产 |
| Worker Secret | `MAIL_API_KEY`, `MAIL_FROM` | staging 专用 Resend Key 和已验证域名的发件地址 |
| Worker Secret | `TURNSTILE_SECRET_KEY` | staging Widget Secret；不得使用测试 Secret |
| Worker Secret | `ADMIN_ACCESS_SECRET`, `ADMIN_MFA_ENCRYPTION_KEY` | 各自独立随机值，至少 32 字符；加密 Key 丢失会使已绑定的 TOTP 无法解密 |
| Worker Secret（仅获授权的真实 AI 联调） | `DEEPSEEK_API_KEY` | staging 专用 Key；默认不设置 |
| Worker vars（仅获授权的真实 AI 联调） | `REAL_DEEPSEEK_TEST_ENABLED`, `REAL_DEEPSEEK_TEST_USER_EMAIL`, `REAL_DEEPSEEK_TEST_DAILY_BUDGET_MICRO_USD`, `DEEPSEEK_INPUT_USD_PER_MILLION`, `DEEPSEEK_OUTPUT_USD_PER_MILLION` | 双重显式开关、单一邮箱、最高 0.10 美元/日；费率按 DeepSeek 当前**峰值**价格核对 |
| 网站构建变量 | `PUBLIC_API_BASE_URL`, `PUBLIC_TURNSTILE_SITE_KEY` | staging API HTTPS Origin、staging 公开 sitekey；正式构建缺 API 地址时不会回退到本机 |
| 插件构建变量 | `REPLY_COPILOT_WEBSITE_URL`, `REPLY_COPILOT_API_URL` | 指向 staging 官网/API，确定实际扩展 ID 后填写 Origin |

Secret 通过 Cloudflare Dashboard 对**选定 Worker 环境**设置，或经批准后用 `npx wrangler secret put <NAME> --env staging` 逐项输入。不要把真实值写入 `.dev.vars.example`、`wrangler.jsonc`、Pages 的公开变量、GitHub PR、浏览器控制台或聊天记录。

## Resend 操作与验收

1. 在 Resend 验证 staging 专用发信域名，按控制台要求添加 DNS 记录，等待状态为 verified。查看免费发送额度与收费条件。[Resend 域名设置](https://resend.com/docs/dashboard/domains/introduction)
2. 创建只用于 staging 发件的 API Key；配置 `MAIL_API_KEY` 和 `MAIL_FROM`。只向自己控制的测试邮箱发送注册及重置密码邮件。
3. 从真实 Chrome 官网注册：邮件应收到中文验证码，10 分钟内有效且只能用一次。重复或错误验证码不会发放额度；邮件发送失败时页面应提示失败，待注册记录被清除。[Resend 发送 API](https://resend.com/docs/api-reference/emails/send-email)

## Turnstile 操作与验收

1. 创建 staging 独立 Widget，允许的 hostname 仅为 staging 官网；将公开 sitekey 放入网站构建变量，将私密 Secret 放入 staging Worker Secret。[Cloudflare Widget](https://developers.cloudflare.com/turnstile/get-started/)
2. 注册页 Widget 使用 `action=register`。Worker 调用 Siteverify 并同时检查 `success`、hostname 与 action；无 Token、错误域名、过期或复用 Token 均应拒绝。官方测试密钥仅供本机开发，不可用于 staging/production。[服务端验证](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)

## 真实浏览器端到端验收

1. Chrome 打开 staging 官网，使用自己的测试邮箱完成 Turnstile、收到 Resend 验证码并注册。`/account` 应显示免费 200、付费 0。关闭标签再打开，登录 Cookie 仍可用；登出后受保护请求应为 401。
2. 新开隐身窗口或另一浏览器会话验证登录、错误密码和重置密码；重置成功后旧密码不能登录。检查 Chrome Network：网站请求携带 Cookie，跨域预检通过，Cookie 不暴露在 JS。
3. 安装**staging 构建**的现有插件，核对 ID 和 `EXTENSION_ORIGIN`。发起设备码、在官网批准、在插件完成绑定。官网与插件显示同一余额；拒绝的 Origin 不能绑定。
4. 在 X 回复框生成一次，200→199，三种风格直接切换不再扣费；同一 `requestId` 重试返回缓存结果而不二次扣费。确认旧 `chrome.debugger + Input.insertText` 自动填入路径和手动发送仍正常。生成失败按规则返还次数；状态不确定的请求应保留待核查预留，不自动触发第二次付费调用。
5. 两个测试账户并发生成，检查 `credit_accounts` 无负数、`credit_ledger` 每次成功仅一条扣费；在低预算下并发请求应只接受预算允许的数量。管理员概览应同时显示已结算成本和进行中预留成本。
6. 普通用户、无 MFA 的管理员、错误或重放的动态验证码、过期管理员会话均不能访问管理数据。管理员可查看真实请求、成本、额度流水、未付款订单；创建结算订单后额度**不变**。
7. 插件不自动点击 X 的发送按钮；Auto Poster 项目保持独立。完成后关闭真实 AI 测试开关，保存测试结果和脱敏截图。

## 目前仍需云端确认

- 未取得真实 Cloudflare D1 ID、域名和插件 ID，配置检查会故意失败；未执行远端迁移与部署。
- Resend、Turnstile、Cookie、Chrome 插件绑定及真实 DeepSeek 的**云端/真实浏览器**验证尚未进行。
- 管理员 MFA 已实现 TOTP、加密存储、单次验证码防重放和短时会话；生产入口仍被 `ADMIN_PORTAL_ENABLED=0` 锁定。正式开放前还需审查密钥备份/恢复、审计、域名与浏览器安全。
- 支付仍未开放。订单保持 `pending`，只有本地模拟结算接口可发放测试额度；没有支付宝或 USDT 真实支付。
