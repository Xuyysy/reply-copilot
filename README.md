# Reply Copilot：额度商业化开发版

独立 Chrome MV3 扩展、Astro 官网、Cloudflare Worker 和 D1。当前仅完成本地与测试环境开发，**没有部署生产版本，也没有启用真实支付或付费 DeepSeek 调用**。Auto Poster 在另一个仓库，未参与本次修改。

## 当前规则

- 注册填写用户名、邮箱和密码，完成 Turnstile 与邮箱验证码后，一次性获得 200 次免费 AI 生成额度。免费和付费额度均不主动过期。
- 一次请求返回自然、幽默、观点三个候选，只扣 1 次；切换、复制、填入都不扣。已确认失败且没有可用结果会返还预留额度；结果不确定的请求保留供人工核查。
- 正式账户统一通过 Worker 调用 DeepSeek；开发者自己的 Key 只在**本地开发模式**使用。原生 X 输入机制 `chrome.debugger` + `Input.insertText` 未改，插件不会点击发送。
- 套餐由 D1 管理，初始为 400 次 $1.99、1,000 次 $3.99、2,000 次 $6.99。支付接口尚未接入。创建待付款订单不会扣款或增加额度。本地管理员可以使用受保护的模拟到账接口做测试。

## 本地启动

要求 Node.js 22+。首次启动：

```bash
cd api
npm install
cp .dev.vars.example .dev.vars
# 把 AUTH_HASH_SECRET、PASSWORD_PEPPER、ADMIN_ACCESS_SECRET 换成本地随机长值
npm run migrate:local
npm run dev
```

另开终端：

```bash
cd web
npm install
npm run dev
```

访问 `http://127.0.0.1:4321`。Astro 开发服务器的注册页自动使用本地模拟人机验证；只在 `ENVIRONMENT=development`、本地网站 Origin 和测试 Secret 同时满足时，Worker 才接受该测试令牌。若需在 VS Code 查看本地验证码，可在 `api` 目录运行 `npm run dev:log`，然后打开同目录的 `local-worker.log`，查找 `[LOCAL EMAIL ONLY] 邮箱: 六位验证码`；不会发送真实邮件。日志已加入 `.gitignore`，不要将其手动提交或分享。`AI_MODE=mock` 和 `AI_MOCK=1` 返回固定模拟候选，不调用真实 DeepSeek。正式构建仍需要真实 Turnstile sitekey 和 Secret。

官网继续使用 Astro 路由和静态营销页面。注册登录、账户中心和管理后台使用按页加载的 React 组件与 shadcn/ui；语言默认为简体中文，可在顶部切换英文，选择保存在当前浏览器。管理后台的口令和短时 MFA 令牌只保存在当前页面内存中。充值订单仍为待付款状态，页面不会触发付款或发放额度。

修改前端依赖后，如果本地登录页的标签点击无反应，先在 `web` 目录运行 `npx astro dev stop`，再运行 `npm run dev -- --force --background`，让 Vite 重新生成依赖缓存。运行 `npm run test:browser:dev` 会用独立的 Chrome 测试配置访问当前的 `http://127.0.0.1:4321/login`，实际点击登录、注册、找回密码标签，并在刷新后再次验证；不会修改本地账户数据。

在仓库根目录运行 `npm run build:dev`，然后在 Chrome 扩展程序页面加载 `dist/development`。扩展设置中心点击“连接官网账户”，在官网确认设备绑定。若 X 标签页在扩展重新加载前已打开，也刷新该标签页。

当前新用户可从定价页直接进入 `/login?mode=register`，插件的新手页和 X 悬浮窗也提供“免费注册并连接”和“已有账号登录”两个入口。官网批准设备码后，插件还要完成令牌交换才显示已连接；重复打开新手页会读取现有连接。悬浮窗的“自动生成建议”开关与 Side Panel、完整设置中心共用 `behaviorPreferences.autoGenerateOnReply`。关闭时仍可手动生成，插件始终不会自动发送 X 回复。Side Panel 默认显示账户、余额、本地统计和快捷偏好；从 X 明确发起的新请求才进入回复工作模式。

修改插件后重新运行 `npm run build:dev`，到 `chrome://extensions` 点击 Reply Copilot 卡片的刷新按钮，再刷新已打开的 X 标签页。新图标的 SVG 源文件位于 `icons/reply-copilot.svg`，16/32/48/128 像素 PNG 一并打包。网页开发服务器通常会热更新前端文件；如果登录页交互停止响应，按上面的 Vite 重启步骤处理。

旧版本本地 Voice Profile、写作样本、历史与 Key 不清除。迁移保留旧 D1 的 `users`、`trials`、`daily_usage`、`licenses`、`sessions`、`ai_requests`。当前账户只有开发测试数据，迁移给旧已验证账户各补发 200 次，唯一赠送记录防止重复领取。旧账户可以用邮箱找回密码后登录。

## 管理后台

`/admin` 需要账户在 D1 中被**明确**设置为 `admin`，且 Worker 设置独立的 `ADMIN_ACCESS_SECRET`。本地初始化时，先正常注册并验证一个账户，再仅在本地 D1 中执行：

```bash
cd api
npx wrangler d1 execute DB --local --command "UPDATE users SET role='admin' WHERE email='your-test@example.test'"
```

后台安全口令与 15 分钟 MFA 会话只保存在当前页面内存中。管理员 TOTP 已实现；生产入口仍由 `ADMIN_PORTAL_ENABLED=0` 锁定，正式开放前仍需安全审查和受控初始化。管理操作在 `admin_audit_logs` 留痕。

本地模拟到账仅用于开发：管理员在本地 Worker 向 `POST /v1/dev/orders/{id}/settle` 提交 `eventId`、`amountCents`、`currency: "USD"`，必须带有效网页会话、CSRF、`X-Admin-Access` 与完成 TOTP 后取得的 `X-Admin-Session`。接口校验订单快照金额、币种和状态；生产环境返回 404。不能将此接口当作真实支付回调。

## 验证

```bash
npm test
npm run build:dev
npm run build:production
npm run test:browser:extension
cd web && npm test
cd ../api && npm run typecheck && npm run test:local && npm run test:browser:local
```

`api/test:local` 创建临时 D1 和本地 Worker，使用模拟邮件、Turnstile 与 AI，验证注册、密码登录与重置、一次性赠送、设备绑定、扣减、失败返还、并发、待付款订单、金额验单、模拟到账、防重复发放和后台权限。不会请求真实付费模型或支付渠道。Chrome 上的 X 原生回复输入仍需人工实测。

## 生产前

请先看 [预发布联调手册](docs/staging-runbook.md)、[部署与服务配置](docs/cloudflare-deployment.md)、[API 契约](docs/cloudflare-api-contract.md)、[隐私说明](PRIVACY.md)。远端 D1 仍是占位 ID；需要由运营者设置 Resend 验证域名、Turnstile、Worker Secrets、HTTPS 域名、真实扩展 ID、成本费率和预算。真实支付、退款、手续费报价、管理员安全验收、法律文本审核与生产联调均未完成。未经确认，不要部署。
