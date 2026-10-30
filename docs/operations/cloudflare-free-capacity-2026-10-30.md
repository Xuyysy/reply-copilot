# x-Reply-Helper｜Cloudflare Workers Free 容量分析（2026-10-30）

**状态：只读调研与初步容量预算，不是压力测试或用户承诺；未修改线上配置或业务数据。**

## 官方免费额度（2026-10-30 核对）
- Workers：100,000 次入站调用/天（账号级共享）；单请求 CPU 10ms，等待网络不计入 CPU；同时有子请求和连接限制。https://developers.cloudflare.com/workers/platform/limits/
- D1：账号级 5,000,000 行读取/天、100,000 行写入/天；每个 Free 数据库最大 500MB，账号总 5GB。自 2026-09-01 起超过每日读写上限会返回错误，额度按 UTC 零点重置。https://developers.cloudflare.com/d1/platform/pricing/ 及 https://developers.cloudflare.com/d1/platform/limits/
- Pages：不调用 Functions 的静态页面资源请求免费、不限次数；调用 Pages Functions 则与 Workers 共用每日请求限额。免费构建 500 次/月。https://developers.cloudflare.com/pages/functions/pricing/ 及 https://developers.cloudflare.com/pages/platform/limits/

## Production 当前状态（只读）
- GitHub 代码基线：`codex/production-ai-model-management@2d58c42e`；Production Worker 版本截至本轮对应 `911038c0...`，正式 API `api.x-reply-helper.top`，独立正式 D1 数据库 `reply-copilot-production`。
- Production D1 元数据：约 2,797,568 字节（约 2.8MB），距离单数据库 500MB 上限很远。
- 匿名生成记录（UTC 日历日）：2026-10-29 共 371 次 AI 请求记录、364 次成功、4 个不同账号；2026-10-30 截至约 12:30 UTC 共 492 次 AI 请求记录、484 次成功、8 个不同账号。账号总数的只读聚合为 10。历史测试/个人高频使用可能使此样本显著不代表典型用户行为。
- Cloudflare Analytics SQL API 的匿名聚合，UTC 2026-10-29 全天：正式 API 域名约 3,492 条 HTTP 请求；Production D1 读 100,302 行、写 14,630 行；同账号另一个 Staging D1 读 12,402 行、写 4,682 行。
- UTC 2026-10-30 00:00–12:30（**不完整的一天，不可与全天直接比较**）：正式 API 域名约 4,114 条 HTTP 请求；Production D1 读 400,894 行、写 15,640 行；另一个 Staging D1 读 70,374 行、写 2,539 行。
- 这些数据为不同统计来源的聚合，HTTP 总数包括登录/后台/其他访问，不能直接解释为单个 AI 会话的精确调用链。D1 读写行数为 Cloudflare 计量，不是 SQL 请求次数。Workers 免费额度可能还被同账号其他 Worker/Pages Functions 使用；这些请求未全部查取。

## 初步容量推算

- 目前由两个时间窗粗略得到正式 API HTTP 请求数/生成记录约 8–10；Production D1 写入行数/生成记录约 32–40。数字混有固定业务及管理/测试流量，**不是**单次生成的独立测量；规模变大后比率不一定维持。
- Free 写入额度 100,000 行/天，以约 32–40 行/生成推算的**理论**单一业务写入瓶颈约 2,500–3,125 次生成/天，尚未扣除 Staging、注册、支付、其他后台操作和突发保留空间。
- **保守阶段性运营预算：1,500–2,000 次 AI 生成/天**，预留安全余量而非硬上限。根据每个 AI 日活平均每天 2/5/10/20 次生成，大致对应 750–1,000 / 300–400 / 150–200 / 75–100 AI 日活。仅表示使用生成功能的日活；不是累计注册用户或独立网站访客容量。
- D1 读取在 2026-10-30 半天达 400,894 行，若查询扫描随用户和订单/流水表增长，**行读取可能提前成为瓶颈**；必须监控真实 D1 rowsRead、rowsWritten 的近 7 日峰值/用户增长趋势。每次 Worker CPU 10ms 上限也是独立约束，不能由 D1/HTTP 使用量证明 CPU 安全。
- Qwen 模型费用不包含在 Cloudflare 免费额度中；Resend 发送额度与支付通道也要独立核算。

## 建议的下一步

1. 现在无需仅因注册人数增长升级。实际 D1 账号级日写入超过约 60,000–70,000 行，或实际请求、CPU、数据库读数接近 60%–70% 配额时，启动优化/升级准备；不要等配额耗尽。
2. 压测和微观度量放到 Staging，不对 Production 模拟批量创建/扣费或真实发信。
3. 选择优化顺序：先监控每次成功生成平均 D1 写入与异常扫描，审查额度预占/ACK 写入操作中是否有可安全合并或低成本实现；确保不牺牲财务账本一致性、回放幂等和安全性。可考虑按业务量升级 Workers Paid（现行基础约 $5/月，最终以账号实际账单为准）。https://developers.cloudflare.com/workers/platform/pricing/

**未部署、未修改 D1/Worker/Pages、未发起模型请求。**
