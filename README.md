# Reply Copilot v0.3.0-beta

Reply Copilot 是独立的 Chrome MV3 扩展、Astro 官网和 Cloudflare Worker/D1 后端。当前交付为**本地可运行内测版**；没有正式部署、真实支付或生产邮件服务。Auto Poster 在另一个仓库，本仓库不包含它。

## 本地启动

需要 Node.js 22+。分别打开两个终端：

```bash
cd web
npm install
npm run dev
```

```bash
cd api
npm install
cp .dev.vars.example .dev.vars
# 将 AUTH_HASH_SECRET 改为至少 24 字符的随机值；保持 AI_MOCK=1
npm run migrate:local
npm run dev
```

访问 `http://127.0.0.1:4321`。本地验证码只打印在 Wrangler 终端中，绝不返回到网页接口。测试模式的 AI 返回固定示例，不会调用付费 DeepSeek。

在仓库根目录执行 `npm run build:dev`，再到 Chrome 的 `chrome://extensions` 加载 `dist/development`。扩展设置中心点“连接官网账户”：官网确认绑定后，扩展会领取独立令牌。旧 Key、Voice Profile、历史记录保留。X 页面如已打开，重载扩展后也需刷新 X 标签页。

用户可以继续通过本地开发模式使用自己的 Key。真实试用账户则由 Worker 托管 AI；本地 `AI_MOCK=1` 用于不付费的联调。终身许可证才走原有 BYOK `DeepSeekClient`。原有 `chrome.debugger` + `Input.insertText`、复制备用入口、手动发送步骤均未更改。

## 本地许可证模拟

先用邮箱在本地官网登录，然后执行：

```bash
cd api
npm run license:local -- grant your-test@example.test
npm run license:local -- revoke your-test@example.test
```

脚本强制使用 Wrangler `--local`，没有远端或公开激活接口。授权或撤销后刷新官网与插件账户状态。终身版每个许可证最多激活 2 台插件设备，使用用户自己的 DeepSeek Key；模拟授权不代表付款。

## 验证

```bash
npm test
npm run build:dev
npm run build:production
cd web && npm run build
cd ../api && npm run typecheck && npm run test:local
```

`api/test:local` 创建独立临时 D1，启动本地 Worker，模拟邮箱和 DeepSeek，检查登录、CSRF、设备绑定、30 次额度、幂等与并发，结束后删除临时库。它不会向真实 DeepSeek 发请求。Chrome 上的 X 原生回复输入还需人工实测；Chrome 调试提示可能出现。

## 服务端规则

- 首次邮箱验证成功时创建 7×24 小时试用；时间来自 Worker，UTC 入库。
- 每天北京时间 00:00 重置 30 次额度。一次生成三种风格计 1 次，切换现有候选不计次。
- D1 `batch()` 中用唯一请求键、条件插入和条件更新原子预留用户额度与全站预算。同一请求重试只返回原结果或明确错误，不再次调用模型。
- 预留后上游失败或结果不确定仍计 1 次，避免重复调用导致无限成本；接口会说明失败。原结果仅保留 10 分钟用于幂等重放。
- 用户同一时刻最多有 1 个进行中的托管请求；全站每天默认上限 300 次。生产部署前需按真实成本重新配置。
- 每日清理过期验证码、会话、设备码、限流桶；短时回复正文到期清除，AI 请求元数据保留 30 天，额度统计保留 90 天。

## 生产准备

详见 [Cloudflare 部署准备](docs/cloudflare-deployment.md) 和 [API 契约](docs/cloudflare-api-contract.md)。生产仍需配置 Cloudflare 账户、D1、官网和 API 的 HTTPS 同站域名、真实邮件适配、Worker Secret、正式扩展 ID，并经安全与隐私审核。**目前不要发布生产构建**：若未配置 Resend 邮件凭据，生产登录会明确返回 `MAIL_NOT_CONFIGURED`。支付尚未接入，$10 为计划早鸟价，计划原价 $15，买断不包含终身免费 AI 调用。
