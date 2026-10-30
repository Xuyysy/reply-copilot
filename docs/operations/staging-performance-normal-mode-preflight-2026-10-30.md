# Reply Copilot｜性能候选 Staging 验证：保留现有真实业务模式（2026-10-30）

> 状态：**预部署核查已完成；性能候选尚未部署**。这是操作交接清单，不是 Staging 已通过验收的报告。

## 用户明确决定

在 Staging 性能验证期间**不关闭支付、不关闭 AI、不切换 Mock，也不关闭其他现有业务开关**。维持现行 Qwen、支付/回调、管理员能力、数据结构、原有安装、Secret、环境路由和每日预算。允许通过经授权的 Staging 测试账号开展**小规模、用户主动操作的真实 AI** 验证，但不批量生成、无人值守自动发帖或创建真实支付订单；任何费用必须在真实调用前确认当前模型费率和测试预算。没有要求将性能候选直接发布到 Production。

## 2026-10-30 只读核查所得（Cloudflare 实时 API / GitHub）

| 项目 | 当前核对结果 |
|---|---|
| 性能候选 | `codex/generation-to-composer-performance@e64bf2cf493c8a5e235665d798afc2116b6e0a91`；Codex 本地 698/698 和 Mock P90 275.36→249.57ms **非真实 X 指标** |
| Staging Worker | `reply-copilot-api-staging`，部署 `076ec210-0b38-478a-b249-0bf37ef9c15b`，版本 `3d24918f-e2bf-4a9e-8de8-a80e5114e23d`，100% 流量 |
| Staging Pages | `x-reply-helper-staging`，最新 `da89f9eb-33da-4d35-ac90-594875b17d10`，success；该构建元数据 `commit_dirty=true` |
| Staging D1 | `reply-copilot-staging`，`cd44bb44-b525-42c4-b286-2cc84dae7fdb`；迁移 0018 已执行 |
| 正常业务开关 | `ENVIRONMENT=staging`、`AI_MODE=production`、`PAYMENTS_ENABLED=1`、D1 `ai_enabled=1`、`purchase_enabled=1`、`daily_cost_limit_micro_usd=5000000`（现有 $5/UTC 日预算；**不修改**） |
| 当前激活模型 | Staging D1 配置：`qwen` / `qwen3.7-flash`、`openai_chat`、max output 1200、模型超时 25 秒 |
| 既有 Staging 扩展身份 | Worker 严格校验 `EXTENSION_ORIGIN=chrome-extension://kaaehkpihjenlhjjfjcopkjhegmfmchk`；该已安装扩展的公钥/生成包身份尚**未通过本轮独立重建**核实 |
| 正式生产 | 不纳入本轮变更：正式 Worker `reply-copilot-api-production`、正式 D1、正式 Pages、商店版本均不动 |

GitHub 比较：`e64bf2cf` 对仓库 `codex/v0.4-credits@b9ae6002` 是 ahead 19 / behind 0，但 **Staging 线上此前有 `dirty=true` 的手动构建，不能仅凭 Git 祖先关系证明覆盖绝对安全**。

## 先决条件 / 不可跳过的门禁

1. **保持原业务配置**：部署前后从 Cloudflare GET 只读导出 Worker 绑定的**名称、类型与非敏感变量值**，记录机密名称清单但不读取/打印任何 Secret 值。保持 `AI_MODE=production`、`PAYMENTS_ENABLED=1`、`purchase_enabled=1`、`ai_enabled=1`、`XIAODOU_WEBHOOKS_ENABLED` 和现有回调、模型选择、预算、D1、路由不变。Wrangler 官方支持 `keep-vars`，可用于保留 Dashboard 上的现有变量；**但必须核对代码配置中显式声明的变量不会被误覆盖**，完成部署前后的结构 diff。Secret 默认部署不删除，但仍需比对绑定名称和类型。官方依据：https://developers.cloudflare.com/workers/wrangler/commands/workers/
2. **防止回退 Staging 既有功能**：对当前 staging Worker 源码及现有 `dirty=true` Pages 的特殊变更做差异核查；本轮原则上**只更新 Staging Worker**，不部署任何 Pages，更不能由候选整包覆盖已存在的页面修改。确认 0018 schema 与新代码兼容，零迁移。
3. **复用真实 Staging 扩展 ID**：从当前受信的 Staging 原安装/本机旧发布目录读取**公开** manifest key / 公开 RSA 公钥，运行 `scripts/extension-identity.mjs` 做 SHA256→ID 校验，必须精确等于 `kaaehkpihjenlhjjfjcopkjhegmfmchk`。若没有原公钥，**不得直接加载一个新 ID 的普通解压包冒充老 Staging**，不得为了省事更改原有 `EXTENSION_ORIGIN`、拆掉 Origin 校验或覆盖旧安装；先解决可复现构建。
4. **部署前重跑** `npm test`、API/Web typecheck、Worker dry-run、隔离 Staging 构建与来源文件 SHA/manifest 审计；原候选 `698/698` 只是 Codex 的历史本地结果，本次部署应提供新的可复现日志。
5. **明确回滚**：部署前固定保存 Staging Worker 旧版本 `3d24918f...` 和部署 `076ec210...` 的回退操作、密钥/变量/路由摘要；先走 dry-run，审计部署产物，生产资源名称不得出现在部署目标中。不能依靠“本地测试通过”跳过线上 smoke。
6. **无需关闭 AI/支付**：只使用专用测试账号做少量已预算的正常生成，并保证测试中不会调用支付创建/退款接口。先在 Staging 验证无付费请求的健康、路由、设置只读状态，再由用户本人在真实 X 选择帖子并点击生成，**只填入草稿，不点发布**。
7. **验收指标**：按报告的诊断开关采集实测点击→编辑器核验 P50/P90（样本太少时不能宣称稳定 P95）、成功/取消/失败及 timeout、ACK、扣费唯一性；旧版/候选应在相近 X 文本、网络、设备下对照。真实调用的额度和模型成本必须核对，不能将本地 Mock 降幅冒充用户体验。
8. **合规与隐私**：诊断默认关闭；仅匿名固定阶段时长，本机内存统计；不传正文、用户身份、URL、requestId、密钥、原始错误。现有 X 编辑框关联、用户手动发送约束、原文/草稿不覆盖均不变。若出现串帖、超时、错误计费、意外支付操作立即回滚 Worker、停测，不必关闭现有业务开关。
9. **Production 另行审批**：即使 Staging 验收通过，仍不可自动部署正式 Worker、商店新插件、生产 D1 或修改 Qwen/计费策略。

## 本轮执行边界

截至这份文件编写时，已做 GitHub 与 Cloudflare **只读**核查，**没有**部署性能候选、上传扩展、覆盖现有插件、变更开关、扣费生成、发送邮件、创建支付或修改任何 D1 数据。

下一执行者应具备可访问仓库完整工作树、既有 Staging 扩展公开公钥和受控 Wrangler 部署通道的环境；若缺少上述构建/身份条件，及时报告证据缺口，不把“已准备”写成“已部署”。
