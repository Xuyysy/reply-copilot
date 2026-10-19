# x-Reply-Helper 项目交接说明

更新日期：2026-10-19

这份文档给后续接手的 ChatGPT / Codex 对话快速了解项目当前状态。继续开发前，仍应以 GitHub 仓库的最新代码、分支和部署状态为准；不要把文档中的状态当成永远最新。

## 仓库与分支

- GitHub：`Xuyysy/reply-copilot`（私有仓库）
- 当前开发分支：`codex/v0.4-credits`
- 当前工作线：草稿 PR #2；不要合并 PR 或改动 `main`，除非用户明确授权。
- 本文档编写前的代码提交：`670e195a70170d05407fcbfb6b41549c05215277`
- 当时 GitHub 上 `origin/codex/v0.4-credits` 停在 `eb50ee1e5da55adc91e10e88dbfd628435f61813`；当前本地开发分支比远端多 12 个提交。此前任务明确要求暂不推送，因此这些代码提交没有随本文档上传。Staging Worker 已从本地代码部署，但后续对话不能假定 GitHub 上的 PR 分支已经包含这些提交。
- 最近部署到 Staging 的 Worker 版本：`36ad57c7-707f-4ced-9807-de1133119dbe`

## 产品与代码结构

- 产品对外品牌严格写作 `x-Reply-Helper`。
- Chrome 扩展：根目录的 `extension/`、`content/`、`options/`、`sidepanel/`、`onboarding/` 等目录；实际目录以当前仓库为准。
- 官网：`web/`，使用 Astro + React。
- API：`api/`，使用 Cloudflare Workers。
- 数据库：Cloudflare D1，迁移位于 `api/migrations/`。
- 支付：复用现有订单、支付事件、额度账本和额度批次；小豆 RSA2 适配在 `api/src/xiaodou.js`、订单流程在 `api/src/payments.ts`。

## 重要业务规则

- 邮箱验证成功的新用户首次获得 200 次免费额度，不主动过期。
- 一次 AI 生成返回三种风格候选，只扣 1 次；切换或复制候选不额外扣费。
- 额度消耗顺序：免费额度、历史付费额度、按购买时间 FIFO 的新付费批次。
- AI 失败或未确认交付不能被记为成功消费；真实支付未被可信平台签名事件或可信查单确认前不能发放额度。
- 普通退款规则以订单对应额度批次的真实使用记录为准；历史订单不因迁移自动获得退款资格。
- 插件将回复填入 X 后，最终发送必须由用户手动确认；保留 `chrome.debugger + Input.insertText` 输入路径。

## Staging 当前状态

- Worker：`reply-copilot-api-staging`
- API：`https://api-staging.x-reply-helper.top`
- 官网：`https://staging.x-reply-helper.top`
- D1：`reply-copilot-staging`，UUID `cd44bb44-b525-42c4-b286-2cc84dae7fdb`
- 迁移：截至最近部署，远端 D1 已应用 `0001`–`0009`；查单诊断修复不需要新迁移。
- 最近 Worker 版本：`36ad57c7-707f-4ced-9807-de1133119dbe`，部署记录为 100% 流量。
- 当前安全开关：`PAYMENTS_ENABLED=0`、`XIAODOU_WEBHOOKS_ENABLED=1`、`AI_MODE=mock`、`REAL_DEEPSEEK_TEST_ENABLED=0`、`ADMIN_PORTAL_ENABLED=0`、`XIAODOU_NETWORK_DIAGNOSTIC_ENABLED=0`。
- 12 项 Staging Secret 名称在最近一次部署后仍存在；Secret 值未读取、未放入仓库。
- 健康检查最近返回 200；`/v1/packages` 返回 200 且 `paymentAvailable=false`。
- 本地全套验证最近通过：`npm test`（166 项）、API typecheck、`check:staging`。

## 当前待处理事项：原小豆支付订单仍待核对

- 本地 Staging 订单 ID：`7fdc3d09-a7b1-47c5-97dd-827d5ad0b178`
- 小豆商户订单号：`XRH_7fdc3d09a7b147c597dd827d5ad0b178`
- 金额：1006 分（¥10.06）
- 最近只读 D1 状态：订单 `awaiting_payment`、支付状态 `unknown`、未到账、结算投影 `pending`。
- 首次创建订单曾返回 `NETWORK_UNCERTAIN`。没有证据证明小豆侧创建成功或付款成功。
- Worker 根路径无凭证 GET 诊断成功取得 HTTP 404（约 771ms）；这只证明到 API 主机的基础 HTTPS 连通，不证明带签名查单接口可用。
- 已部署的刷新错误诊断会在 Staging 响应中提供安全的 `code`、`diagnostic.stage`、`diagnostic.upstreamHttpStatus` 和 `requestId`；Production 仍返回通用错误。
- 用户需在已登录的 Staging 账户中心手动刷新该原订单一次，再把脱敏错误类别和阶段提供给后续对话。不要自动刷新、重新下单、付款、退款或修改此订单。

## 安全与协作边界

- Staging、Production 必须隔离。禁止未经授权部署、迁移远端 D1、修改 DNS、写入 Secrets、开通真实支付、真实退款或调用真实 DeepSeek。
- 不输出或提交 API Key、密码、Cookie、Session、验证码、私钥或其他 Secret。
- 不操作同仓库之外的 Auto Poster（`Xuyysy/x-posst`）。
- 只在用户明确授权的范围内做远端操作；遇到部署超时先查询实际活动版本，不能盲目重复部署。
- 用户偏好：所有面向用户的界面使用简体中文；回复要自然、像真人交流，避免生硬的 AI 腔。

## 建议新对话的起点

先阅读本文件，然后检查 GitHub `codex/v0.4-credits` 的最新提交、PR #2 状态和 Staging 实际活动版本。对于原 UNKNOWN 订单，等待用户在浏览器手动刷新后的脱敏响应；不要把 HTTP 404 根路径探测解释为支付查单成功。
