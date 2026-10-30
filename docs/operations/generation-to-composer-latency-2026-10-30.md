# x-Reply-Helper｜生成到回复框的延迟基线（2026-10-30，只读审查）

> 范围：Production 0.3.2 插件 + Production Qwen / qwen3.7-flash v1。2026-10-30 通过连接的 GitHub 源码和 Cloudflare Production D1 的 **只读匿名聚合 SELECT** 获得。没有发起真实 AI 请求、读取帖子/用户身份、修改代码、D1、配置或部署。此文为优化建议，并非已执行的性能改进。

## 现行链路（代码证据）

1. X 原生 Reply 打开并可信关联编辑框：`content/content-script.js`（匹配编辑框、获取偏好、账户状态，随后自动生成）。
2. 扩展后台：`background/service-worker.js` 依次读 voice profile 和回复风格；`services/reply-engine.js` 读历史和风格统计，`services/ai-provider-router.js` 可能读取账户状态。
3. `services/delivery-coordinator.js` 在受信扩展上下文取账号身份并保存待处理快照；`services/hosted-ai-client.js` POST `/v1/ai/generate`。
4. Worker `api/src/ai.ts` 验证会话、配额/预算、构建 Prompt、选择活动模型；`api/src/ai-model-provider.js` 为配置端点做 DNS 验证后发起 Qwen 非流式 Chat Completions，验证完整 JSON，持久化结果。
5. 扩展校验响应后独立 POST `/v1/ai/requests/{requestId}/delivered`；只有 ACK 成功才向界面返回文本。这个握手与一次扣费、可靠重放相关，不能直接删除。
6. 后台 `history.recordGeneration`、`usage.track`、账户状态标签等步骤当前仍在 `sendResponse` 前 await。
7. `content/content-script.js` 只在可信帖子/空编辑器/可见/焦点等条件满足时调用 `composer-adapter.insertOnce` 分发合成 paste，随后固定等待约 80ms 再验证编辑器文字是否匹配。插件不会点击发布。

## D1 耗时基线

数据源：Production D1 成功请求（`ai_requests.status='succeeded'`），最近 48 小时；过滤掉缺少时间戳或反常负值的记录，并按固定配置版本关联 Qwen。

| 阶段 | N | 平均 | P50 | P90 |
|---|---:|---:|---:|---:|
| 服务端预占创建 → 生成结果登记 | 194 | 3483 ms | 3191 ms | 4621 ms |
| 结果登记 → 服务端交付确认时间 | 194 | 601 ms | 415 ms | 1034 ms |

统计口径：
- 生成阶段 = `(response_expires_at - 600000) - created_at`，因为 `finishGeneration` 将 `response_expires_at` 设置为结果记录时间 + 10 分钟。该阶段包含 Worker 余额处理、端点 DNS 验证、模型耗时等，不等于纯 Qwen 推理。
- ACK 阶段 = `delivery_confirmed_at - (response_expires_at - 600000)`，包括模型结果返回扩展、客户端校验、独立网络 ACK、服务端状态更新；不等于纯网络 RTT。
- 两阶段平均合计约 4084 ms，**不是**点击 Reply → X 编辑框文本可见的端到端计时；遗漏点击前置准备、初始传输、后台持久化/UI/填入等。P50/P90 分段值不能简单相加当成全链路分位数。
- 补充只读 token 统计（随着请求持续发生，样本数稍有变化）：Qwen 成功请求大多数输出 100–199 tokens，对应平均输入约 979 tokens、平均输出约 149 tokens。

## 可优化路径（需 Staging 实验，不直接改 Production）

1. **先补端到端分段基准**：客户端本地 `performance.now()` 记录点击、编辑框绑定、偏好/账户获取完成、Worker 请求开始/结束、ACK 完成、UI 展示、paste 分发、80ms 核验通过；服务端分开观察 DNS、D1 和上游 API 耗时。只输出时间区间、状态码和汇总统计，不记录原帖、回复、账号、Token、Secret 或完整 URL。对比 p50/p90/p95 与成功自动填入率。
2. **去除可证明冗余的等待**：`prepareCurrent` 中偏好与账户读取存在串行依赖；在保证账户状态及可信关联不被绕过的条件下研究并行预取。生成后台存在两次本地历史读取、每次账号身份的 `fetchCurrentUser`、ACK 后历史/使用数据持久化与账户标签再次等待。仅将可容错的非关键统计异步化，确保真正成功/失败仍正确反映。
3. **端点检查耗时**：目前 Qwen 每次请求前 `validateProviderEndpoint` 会通过 DoH 解析，且 A/AAAA 查询顺序进行。先实测该段；可以评估安全等价的并行解析及受限可信供应商缓存，但不能为速度削弱对任意自定义端点的 SSRF、DNS 重绑定和重定向防护。
4. **Prompt 和模型响应**：当前系统一次输出 3 个完整 JSON 回复选项，Prompt 包含 Voice Profile、写作样本及至多 20 条历史。可做长度预算和质量对照，保留三候选/一次扣费/结构一致/旧版兼容，不盲目缩减上下文。再测试合法参数（如禁用思考、输出上限）对质量与 p90 的影响。
5. **ACK 安全优化**：当前独立 ACK P50 415ms、P90 1034ms；评估服务端 DB/认证读取和扩展流程有无安全等价的优化。禁止未经证明就跳过 ACK、提前扣费、双重消费或将未确认草稿自动填入。
6. **不以降低安全为代价**：保留原帖/编辑框可信绑定、空草稿保护、同 requestId 幂等、失败/未知结果重放、跨帖隔离、客户端不自动发送、80ms 文本校验（除非安全等价的可靠检查可取代）。

## 决策与下一步

目前结论是 **存在可量化优化空间，优先测清和削减非模型串行延迟，再进行 Prompt/模型 A/B**。本轮没有用户授权实施性能改动或生产部署；所有目标加速比例都只是实验假设，不保证上线后达到。若开始实施，先经 Staging 校验长短帖子、中文英文、特殊 X 帖子、断网/ACK 丢失、重复点击与账户切换，再由用户人工验收后另行决定正式发布。
