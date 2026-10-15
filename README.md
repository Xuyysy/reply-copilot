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

访问 `http://127.0.0.1:4321`。本地验证码只显示在 Wrangler 终端；`AI_MOCK=1` 返回固定模拟候选，不调用真实 DeepSeek。官网本地使用 Cloudflare Turnstile 官方测试 sitekey；Worker 测试 secret 在 `.dev.vars.example`。正式环境必须更换真实密钥。

在仓库根目录运行 `npm run build:dev`，然后在 Chrome 扩展程序页面加载 `dist/development`。扩展设置中心点击“连接官网账户”，在官网确认设备绑定。若 X 标签页在扩展重新加载前已打开，也刷新该标签页。

旧版本本地 Voice Profile、写作样本、历史与 Key 不清除。迁移保留旧 D1 的 `users`、`trials`、`daily_usage`、`licenses`、`sessions`、`ai_requests`。当前账户只有开发测试数据，迁移给旧已验证账户各补发 200 次，唯一赠送记录防止重复领取。旧账户可以用邮箱找回密码后登录。

## 管理后台

`/admin` 需要账户在 D1 中被**明确**设置为 `admin`，且 Worker 设置独立的 `ADMIN_ACCESS_SECRET`。本地初始化时，先正常注册并验证一个账户，再仅在本地 D1 中执行：

```bash
cd api
npx wrangler d1 execute DB --local --command "UPDATE users SET role='admin' WHERE email='your-test@example.test'"
```

后台安全口令只保存在当前页面内存中。正式上线前仍需真正的管理员 MFA、安全审查和受控初始化流程。管理操作在 `admin_audit_logs` 留痕。

本地模拟到账仅用于开发：管理员在本地 Worker 向 `POST /v1/dev/orders/{id}/settle` 提交 `eventId`、`amountCents`、`currency: "USD"`，必须带有效网页会话、CSRF 与 `X-Admin-Access`。接口校验订单快照金额、币种和状态；生产环境返回 404。不能将此接口当作真实支付回调。

## 验证

```bash
npm test
npm run build:dev
npm run build:production
cd web && npm test
cd ../api && npm run typecheck && npm run test:local
```

`api/test:local` 创建临时 D1 和本地 Worker，使用模拟邮件、Turnstile 与 AI，验证注册、密码登录与重置、一次性赠送、设备绑定、扣减、失败返还、并发、待付款订单、金额验单、模拟到账、防重复发放和后台权限。不会请求真实付费模型或支付渠道。Chrome 上的 X 原生回复输入仍需人工实测。

## 生产前

请先看 [部署与服务配置](docs/cloudflare-deployment.md)、[API 契约](docs/cloudflare-api-contract.md)、[隐私说明](PRIVACY.md)。生产 D1 仍是占位 ID；需要由运营者设置 Resend 验证域名、Turnstile、Worker Secrets、HTTPS 域名、真实扩展 ID、成本费率和预算。真实支付、退款、手续费报价、管理员 MFA、法律文本审核与生产联调均未完成。未经确认，不要部署。
