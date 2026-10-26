# Cloudflare 接入前审计报告

日期：2026-10-16。范围：`Xuyysy/reply-copilot` 的 `codex/v0.4-credits` 分支（草稿 PR #2，基于 PR #1 的 `codex/v0.3-platform`）。本轮仅在本地修改、构建和验证。没有部署 Cloudflare、运行远端 D1 迁移、调用真实 DeepSeek、启用支付、修改 Auto Poster 或合并 PR。

## 结论与边界

- **已完成本地代码清理**：用户端个人 Key 配置和直连路由已移除；生产扩展只声明配置的 Worker API Origin；未配置或配置为本地回环地址时拒绝生产构建。旧个人 Key 先用于一次性风格迁移，再从扩展存储中删除。其他账户、设备、风格、历史及行为存储键不变。
- **已完成本地功能验证**：临时 D1 顺序执行全部迁移，Mock AI 注册赠送、设备绑定、200→199 扣费、同一请求幂等、失败返还、并发预算、订单未付款不赠额、普通用户后台拒绝及管理员审计均通过。本地真实 Chrome 覆盖官网主要流程和插件控制界面。
- **尚不能宣称云端验收通过**：Staging/Production 的 D1 UUID、网站/API 域名和扩展 ID 仍为占位符。Resend、真实 Turnstile、跨站 Cookie、真实 DeepSeek 费率与模型、Chrome 上真实 X 回复输入都需要下一阶段分别验证。隐私、服务条款及退款文本还需经营者和法律审查。

## 主要改动与根因

| 问题 | 根因及处理 | 验证 |
| --- | --- | --- |
| 普通用户仍可找到个人 DeepSeek Key 配置或绕过平台额度 | 设置、引导及直连客户端保留了旧 BYOK 路径；删除界面和客户端，AI 路由只接受服务端 `credits_available` 状态。 | 路由测试、生产包扫描和 Chrome 插件界面检查。 |
| 生产插件权限含第三方 AI 和本地地址 | 源 Manifest 同时用于本地与正式版；构建时仅将明确的 HTTPS API Origin 写入正式 Manifest，拒绝缺失、回环和相同的官网/API Origin。 | 开发及正式构建、Manifest 检查、回环地址边界测试。 |
| 旧个人 Key 长期留在扩展存储 | 旧 schema 迁移只记录版本；改为先迁移旧 Voice Profile，再将 schema 升至 3 并仅移除 `deepseekApiKey`。 | 重复迁移测试确认其他数据保留。 |
| 未开放支付时官网仍能反复创建待付款订单 | Checkout 原按钮会提交 `/v1/orders`；前端只展示套餐预览，服务端在非 development 环境返回 `PAYMENT_UNAVAILABLE`。原订单及本地模拟测试不受影响。 | 支付关闭测试、浏览器定价页、本地未付款额度测试。 |
| 本地端到端测试偶发 Worker 连接重置 | 测试运行中用第二个 Wrangler 进程写同一临时 D1；测试脚本改为直接操作测试专用 SQLite 文件，避免数据库进程竞争。 | 本地 API 与 Chrome 端到端重新运行通过。 |
| 管理后台缺少 AI 服务状态与今日用量 | 原面板仅有月度汇总；复用服务端设置和成本表展示模式、模型、Key 是否配置、今日 Token/成本、预算预留与失败数；不返回 Secret 内容。模式显示兼容开发环境 `AI_MOCK=1`。 | 类型检查、管理员本地 API 断言。 |
| 冻结账户在部分插件界面显示不清楚 | Side Panel 和悬浮窗增加明确冻结提示，并隐藏生成入口；新手引导也说明冻结状态。跳过风格设置后不再误称偏好已保存。 | Chrome 悬浮窗状态检查、账户状态测试。 |

## 权限与安全检查

正式 Manifest 的 `permissions` 为 `contextMenus`（X 选中文本入口）、`storage`（配置与授权令牌）、`sidePanel`（快捷控制）、`clipboardWrite`（复制草稿）、`debugger`（现有 `Input.insertText` 原生填入）。`host_permissions` 只有构建时指定的 HTTPS Worker API Origin；内容脚本限 `x.com` 和 `twitter.com`。开发 Manifest 的本地 API 权限不会进入正式包。未修改 X 输入服务，插件不会自动点击发送。

Worker 继续在服务端验证会话、管理员角色、账户状态、CSRF、Origin、额度及幂等请求；密码哈希、登录限流、一次性设备码、预算预留与失败处理沿用现有实现。本轮安全审查是代码与本地回归检查，尚不等于渗透测试。已跟踪文件的常见密钥字面量扫描未发现真实密钥；本地 `.dev.vars` 与 Wrangler 状态目录受 Git 忽略。真实 Secrets 只能按环境分别配置于 Worker，不能进入插件、官网静态文件或仓库。

`api/migrations/0001`–`0004` 未修改。临时数据库能顺序升级；**没有对用户现有本地 D1 执行迁移，也没有对其副本做升级演练**。云端迁移前须先备份、核对实际迁移记录并在隔离副本演练。旧试用/终身表、存储键、资源名称和内部消息协议保留作为兼容标识，不能根据旧表重新发放额度。

## 已执行检查

| 命令 / 场景 | 结果 |
| --- | --- |
| 仓库根目录 `npm test` | 75/75 通过：根目录测试及官网构建（串行运行）。 |
| `web` 中 `npm test` | 通过：官网构建及 6 项页面测试。 |
| `api` 中 `npm run typecheck` | 通过。 |
| 仓库根目录 `npm run build:dev` | 通过。 |
| 用 `https://web.example.test`、`https://api.example.test` 作为结构测试 Origin 执行 `npm run build:production` | 通过；**这个测试包不可直接部署**。产物无个人 Key 页面、直连 DeepSeek 权限、localhost 地址或开发模拟入口。 |
| 仓库根目录 `npm run test:browser:extension` | 真实 Chrome 通过：设置同步、Side Panel、悬浮窗冻结状态及待处理请求；Chrome CDP 对工具栏 action 点击返回 tab target 限制，该点击需人工复核。 |
| `api` 中 `npm run test:local` | 通过：临时 D1、Mock AI、账户、额度、并发、预算、管理员、退款及订单。 |
| `api` 中 `npm run test:browser:local` 与 `npm run test:browser:dev` | 真实 Chrome 通过：注册/登录、绑定弹窗、取消与确认、200 次赠额、200→199、普通用户后台拒绝等。 |
| `api` 中 staging/production 环境校验 | **按预期不通过**：仍需真实 D1 UUID、Web/API HTTPS Origin 和 Chrome Extension Origin。 |
| `git diff --check` 和已跟踪文件密钥模式扫描 | 通过；未发现空白错误或常见真实密钥模式。 |

以上浏览器测试使用测试页面和临时数据。尚未在真实 X 页面完整走一次生成、复制、`Input.insertText` 填入并手动发送；未运行真实邮件、Turnstile 或 DeepSeek 联调。测试命令的最终重跑结果以提交前终端输出为准。

## 下一阶段配置清单（需单独授权）

Staging 需要经确认的独立 Worker、D1、HTTPS 官网/API Origin、Chrome 扩展 Origin、独立 `AUTH_HASH_SECRET`、`PASSWORD_PEPPER`、`MAIL_API_KEY`、`MAIL_FROM`、`TURNSTILE_SECRET_KEY`、官网公开 Turnstile Site Key，以及 D1 的实际迁移状态。初始保持 `AI_MODE=mock`、`ADMIN_PORTAL_ENABLED=0`、`SITE_DAILY_CAP<=10`；支付接口保持关闭。Production 需另一套独立资源与 Secrets，禁止测试 Turnstile Key、Mock AI、localhost 和共用 D1。

配置校验脚本当前正确拒绝占位值。取得用户下一阶段授权后，先核对资源归属及成本，再创建/修改云端资源、上传 Secret、执行远端迁移和部署。真实 DeepSeek 另需明确授权、专用 Key、官方模型/费率核实及小预算测试；邮件、域名、D1、Worker 和 AI 调用可能产生费用。本轮没有执行这些操作。

## 人工验收步骤

本地官网与 Worker 如已运行，可重启以载入新代码；重新执行 `npm run build:dev`，在 `chrome://extensions` 点击开发插件的“重新加载”，刷新 X 页面。检查新手引导只有账户绑定、偏好与开始使用；设置中心无个人 Key；Side Panel 和悬浮窗的自动生成开关同步且关闭后仍可手动生成。用本地模拟邮箱验证码注册并验证，确认余额从 200 经一次生成变为 199；切换候选、复制、填入不再扣额。确认 X 编辑器显示一份可编辑草稿，用户手动点击发送。官网 `/pricing` 和 `/checkout` 只展示套餐与支付未开放说明；管理员账号进入 `/admin` 查看 AI 状态，普通账号应被拒绝。
