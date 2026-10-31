# x-Reply-Helper｜Production 性能 Worker 发布（2026-10-31）

**实际状态：Production Worker 已部署并独立确认 100% 流量；正式 Chrome 插件与 Pages 没有更新。** 用户先批准性能优化发布 Production，之后明确提出「插件那更新那就算了」，因此此次只实施后端 Worker 发布。**并非整个客户端性能优化完整发布**，不得向外宣称 Staging 中观察到的完整客户端链路已在正式版生效。

## 1. 部署身份

- 已验证 Staging 候选源码：`e64bf2cf493c8a5e235665d798afc2116b6e0a91`；Staging Worker `reply-copilot-api-staging` 经真人真实 X 首轮 8/8 生成 + ACK + D1 单次扣次验证。真实点击到编辑器核验均值 4.38 秒、样本 P90 5.20 秒，尚无旧版同条件真实速度基线；不得宣称实网提速百分比。
- **Production Worker**：`reply-copilot-api-production`
- **本次部署 Deployment ID**：`c8fe0c2a-4bda-47ee-a27e-cbd0b08214da`
- **新 Worker Version**：`09d19d8a-a489-443d-991f-bbb6bc254e20`（版本号 13），于 `2026-10-31T03:03:19.023519Z` 创建，100% 线上流量（Cloudflare deploy API 与随后 GET 独立确认）。
- **新源码 Commit 注释**：`e64bf2cf493c8a5e235665d798afc2116b6e0a91`，脚本 etag `8a1e229b77c5a52793e993b35772e4f39e49b1e1bfe933372048db2954094443`。
- 部署材料来自当前已发布 Staging Worker 的 `index.js`（410424 字符）和 `index.js.map`（629026 字符），通过 Cloudflare 版本上传（尚未切流）、候选版本核对、最后旧部署版本检查，再切 100%。新版本使用全部已有 Production bindings 的 strict inherit；没有拼入 Staging D1/URL/Secret。
- **原 Production 旧版本（回滚用）**：`911038c0-36a9-4062-96b9-38de2b26ef55`，旧部署 `d58118cc-a49e-45db-8041-3394ef49f5a7`。若线上回归，使用 Cloudflare Worker Versions Deployments 将**原版本**部署为 100%，**不要**回滚 D1 或覆盖生产业务数据；此前部署和版本需保留。

## 2. 发布范围与安全配置对照

- **本轮只发布 Production 后端 Worker 性能代码**：主要服务端 DNS A/AAAA 并行安全校验及默认关闭的性能计时支持。没有把 Staging 的`AI_PERFORMANCE_DIAGNOSTICS=1`写入 Production；诊断默认关闭。
- **不发布 Chrome 插件**：Google Chrome Web Store 继续提供已有正式 `0.3.2`，原扩展 ID `fgfjajofkapebgphfidblngcjomkbdaj`。不新建商店条目、不上传 ZIP、不更改原本地插件；`content/content-script.js`、`background/service-worker.js` 等性能优化源码**尚未通过正式扩展更新分发**，所以这不是完整前后端性能改善交付。
- **不发布 Pages**：`x-reply-helper-production` 保持 `0ad5fd22-eecb-4778-85e3-76844c163c19`（隐私政策/FAQ 最小披露发布），未修改网站前端。
- Production D1 原数据库 `d9df7d23-9b9c-44ac-a33a-c24474c15691`，旧迁移至 `0018_ai_provider_management.sql` 已存在；本轮未迁移或改动 D1 数据。
- **生产配置不变**：全部原 30 项 Worker binding 名称、类型核对一致，Secret 值未读取或导出；`ENVIRONMENT=production`，`AI_MODE=production`，`ADMIN_PORTAL_ENABLED=1`，`PAYMENTS_ENABLED=1`，支付商户 `PAYMENT_PROVIDER=xiaodou`，`XIAODOU_WEBHOOKS_ENABLED=1`，生产 API/WEB origin 和原 extension origin 均不变。
- 生产 D1 只读 SELECT：`ai_enabled=1`、`purchase_enabled=1`、预算 `daily_cost_limit_micro_usd=5000000`（$5/UTC 日）、当前激活 `qwen / qwen3.7-flash` v1，**未改变**；负余额账户计数 0、重复 generation_debit reference 组数 0。
- 原定时任务 `0 3 * * *` 已单独 GET 确认保留，Worker 仍有 `scheduled` 和 `fetch` handlers。
- 配置、D1 审计仅 GET/SELECT；未主动调用模型、发邮件、支付、注册或模拟扣费，也未部署 Staging/Pages/扩展。

## 3. 部署后实测限制与下一步

- Cloudflare **部署成功并确认 100%**，且设置、数据库、原插件 ID 和 cron 正常，是本次独立核查完成项。
- 当前工具访问正式公开域名受隔离代理拒绝（Cloudflare 连接器直接 fetch 返回 `403 Forbidden: requests to api.x-reply-helper.top are not allowed`；其他环境 DNS 不可用），故**未独立完成 Production `GET /health`、`GET /v1/packages`、`GET /v1/me` 及真实扩展生成功能的线上 smoke**。403 来自工具环境访问限制，不能宣称是正式 API 对用户返回的结果。
- Cloudflare Analytics SQL `events.httpRequests` 查询部署后 `2026-10-31T03:03:19Z` 起的指定窗口返回空，没有可归因于本次发布的成功/错误流量统计。不能由“空”推断没有请求或零故障。
- **建议人工短路径验收**：已有 Production 原商店插件直接打开 X 空白回复框，生成 1 次可编辑草稿（手动，不发布），检查 3 候选与 1 次额度扣次；核对账户与订单页面展示和官网登录。测试前确认计费，勿批量测试真实账号。若业务出现超时、跨帖、错误计费、支付问题，应按上述旧 Worker Version 回滚（只回滚 Worker，不操作 D1）。
- 性能结论：Staging 的 8 次采样证明了该候选的首轮交付与账本正确，但 **Production 旧版 Chrome 扩展没有分发候选客户端代码，不能引用 Staging 的模拟 9.37% P90 提升说明正式用户端提速**。
