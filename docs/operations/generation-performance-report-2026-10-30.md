# 生成到回复框性能报告（本地候选，未部署）

## 状态与依据

- 独立分支：`codex/generation-to-composer-performance`。
- 生成逻辑对照基线：`98155453560209f3c77de069c34735fccb444a65`，包含 Worker 功能基线 `2d58c42e`。分支同时包含已单独发布的公开政策修复 `e9125d7d7a90acfcb06ed3dfc02c28e7ecb2d8fa`，防止后续回退隐私页。
- 只读核验线上 Worker：`911038c0-36a9-4062-96b9-38de2b26ef55`，部署 `d58118cc-a49e-45db-8041-3394ef49f5a7`，100% 流量。未部署性能 Worker，也未切换模型。
- 当前 Pages 政策修复独立部署：`0ad5fd22-eecb-4778-85e3-76844c163c19`。**这不是性能优化部署**。
- 历史匿名 Production 数据：194 条已 ACK 请求，服务端预占至结果登记平均 3483ms，结果登记至 ACK 平均 601ms。来自已读取的总控与交接页，非本轮重新查询；不能拆成纯模型/DNS/D1 耗时，也不能相加为端到端分位数。
- **真实客户端完整基线尚未采集。** 本轮不操作用户 Chrome/X，不调用真实付费模型，不覆盖任何现有安装。阶段 A 的真实采样仍待 Staging 授权及人工验收。

## 实际优化

1. `content/content-script.js`：编辑器绑定后，偏好与账户预检查同时开始；两个检查仍必须完成且会话仍有效才生成。补充等待后对同一会话/取消状态的核验。没有绕过身份、余额、原帖或编辑框校验。
2. `background/service-worker.js`：并行读取 voice profile 与 reply style。ACK 后本地历史/使用记录仍被 await，与独立账户标签读取并行；不做可能在 MV3 休眠时丢失的 fire-and-forget。
3. `services/history-service.js` / `services/reply-engine.js`：同一个本地快照生成最近20条历史与全量风格统计，原过滤、顺序、条数和计数保持一致；保留不支持快照方法的旧注入实现。
4. `api/src/ai-model-provider.js`：每次模型请求前仍执行 DNS 检查，A/AAAA 同时查询，等两者均完成后验证全部地址。保留每次检查、8秒总超时、CNAME深度/循环、私有地址、保存地址集匹配、手动重定向与认证发送时机；一支失败时中止另一支。没有 DNS 缓存，没有宣称解决原有 DoH/fetch DNS TOCTOU 问题。
5. 可关闭诊断：内容脚本单调时钟记点击、绑定、预检、请求、候选、填入与核验；后台记录准备、所有者查询、存储、云生成、ACK、本地记录与标签；Worker 可记录准备、配额预占、DNS、模型和结果登记。只传固定阶段及有限非负数值、结果类别；不传正文、生成文本、用户、URL、requestId、Token/用量、密钥或原始错误。

独立 ACK、同 requestId 重放、原子扣费、预占释放、预算处理均保留。没有更改 Prompt、模型参数、Token 价格、80ms 核验或粘贴实现。

## 本地对照结果（不是 Production 或真实 X）

24组中文/英文短帖、长帖交替对照；两类写作风格、写作样本及历史夹具。调用实际 content-script、background、HostedAIClient、DeliveryCoordinator、provider 和 generation-flow 代码；帖子关联/编辑器为合成对象，D1边界和上游为本地 mock。**没有验证真实 X 编辑器接受性、真实网络、实际供应商性能或真实浏览器重启。**

固定夹具：模型35ms、DNS A 9ms/AAAA13ms、ACK12ms（另有6ms接口往返）、本地读取4ms（历史6ms）/写入6ms；保留80ms编辑核验。交替 baseline/candidate 顺序减少负载偏差，采用 nearest-rank 分位数。

| 模拟点击→内容核验 | 优化前 | 优化后 |
|---|---:|---:|
| 平均 | 273.47 ms | 247.06 ms |
| P50 | 272.93 ms | 246.55 ms |
| P90 | 275.36 ms | 249.57 ms |
| P95 | 284.48 ms | 250.08 ms |

- 平均降低 26.41ms（9.66%）；P90 降低 9.37%。不应将此比例直接外推到线上3秒以上的模型链路。
- 自动填入夹具：两组均24/24成功、0失败；这不是用户真实 X 成功率。
- DNS均值：24.25→13.37ms；模型均值：36.00→35.92ms，未改变模型。
- 结果登记→编辑核验均值：121.49→122.03ms，**没有观察到改善**。正常账户标签已缓存，本次并行化不是该阶段的重要收益来源。
- 扣除模拟模型等待后，非模型残余均值约237.47→211.14ms；没有达到20%–30%目标，不强行削减ACK/核验以追求比例。
- 同场景上游请求正文哈希逐一一致，验证提示词和参数没有改变。未执行付费的文案质量 A/B；不声称真实质量测评通过。
- [完整机器结果](generation-performance-mock-results-2026-10-30.json) 包含阶段均值/P50/P90/P95。

## 测试与安全

修改前：676/676。新增测试先复现历史重复读取/串行DNS及缺失诊断，再通过实现。

最终：`npm test` **697/697**；API TypeScript、Web TypeScript、Worker dry-run通过；隔离 Staging/Production 扩展构建及最终 manifest/源码审计通过，无 debugger 权限/调用，正式构建保持原商店ID。

覆盖：完整JSON与旧客户端兼容、ACK失败重试/重放与唯一扣费、Worker重建后的待交付重放、账户隔离、取消和迟到响应、草稿保护、重复输入保护、无额度/离线/无效输出、DNS并行/私有AAAA/地址集变更/CNAME/错误与超时。新诊断对象不进入持久化重放输入；默认关闭时无采样上传。

有一次既有隔离表格测试在鼠标事件返回后立即读取 React checkbox 时出现间歇失败；增加有界状态等待后全量通过，未改后台产品逻辑。早期测试与中间修订通过数不作为最终验收。

尚未覆盖：真实X各类DOM的时间分布、真实弱网/后台节流、真实MV3终止与恢复、用户切换账号瞬间的UI行为及付费模型质量。既有关联/编辑器逻辑未改变，已有回归保留，但不能替代用户验收。

## 诊断开关与取数（未来获授权后）

- 默认关闭。扩展受信 Service Worker 控制台启用：`await chrome.storage.session.set({generationPerformanceEnabled:true})`。不需要重置账号/存储；新页面会读取开关，现有页面接收开关通知。
- 在X页面的**扩展隔离上下文**执行 `replyCopilotPerformanceReport()`：按本页接受的回复会话返回至多100个完成样本的匿名聚合；包括成功/失败/取消/未填入计数。它不统计未识别为可信入口的所有点击，不能作为整体站点点击转化率。
- Service Worker 控制台同名命令返回各标签页报送的匿名聚合。关闭编辑器导致取消会单独计数，不混入成功延迟分位数。重试/再生成不算新的原生Reply点击样本。采样仅内存，Worker终止/刷新会清空，未上传远程日志或数据库；请及时导出聚合报告。
- 清空：`clearReplyCopilotPerformance()`；关闭：`await chrome.storage.session.set({generationPerformanceEnabled:false})`。
- 若获准更新 Staging Worker，可仅在其现有安全配置中加入 `AI_PERFORMANCE_DIAGNOSTICS=1`，旧客户端忽略额外的 `performance` 数值字段；客户端请求体/哈希不改变。未设置此标志时无该字段。本轮没有配置任何远端开关。
- 内容脚本、扩展Worker、服务端各自的时钟起点不同；只合并持续时间，绝不直接相减不同上下文的绝对时间。服务端 model 包含网络、读取和响应校验；worker_finish 包含结果及成本登记，不等于精确提交时刻。Workers计时器仅随I/O推进，不能当作CPU profiler（[官方计时文档](https://developers.cloudflare.com/workers/runtime-apis/performance/)）。
- 保留 await 的理由：MV3有终止/空闲生命周期，不将必须保存的交付记录移到回复消息之后（[Chrome官方生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)）。

## 下一步 Staging 计划（尚未授权执行）

1. 保留现有Staging实验目录、账号和ID；先核验其真实安装/公钥路径，再准备独立可回滚验证，不覆盖现有安装。本轮本地Staging产物仅用于编译检查，未带入原安装公钥，**不能宣称已核验原Staging ID或建议直接替换安装**。
2. 先批准只更新Staging Worker的性能代码与开关、配置/绑定全部保留，及隔离插件安装。开始仍为零真实模型调用，跑Mock/开关与错误路径。
3. 另经授权由用户操作真实X首轮8次生成（中英长短各2次），先根据现行费率核对预占并设定测试总成本硬上限；不自动重试、不发帖。对照安装/模型/网络条件一致，采样时避免打开扩展Worker DevTools影响休眠结果。
4. 不足以用8次估计稳定P95；首轮只验证功能/埋点，随后由用户决定是否收集更大样本。包括长时间闲置、后台切回、取消、快速点击、用户输入、账号切换、断网和ACK恢复。
5. 仅在真实E2E/填入成功率/账本与质量验收后再申请Production Worker与插件发布；本地扩展版本仍为0.3.2，不是商店新版本更新包。各优化可按模块/提交独立回退；不涉及D1迁移和财务数据回滚。

## 公开政策优先修复的独立交付

用户在性能任务中要求优先修复线上政策。已发布 `codex/production-privacy-policy@e9125d7`，只改privacy/feedback/FAQ及测试，92/92前端回归；Pages `0ad5fd22-eecb-4778-85e3-76844c163c19`（dirty=false）。线上公开文字不点名具体供应商，保留必要的第三方AI/支付处理、用途、保留、人工请求和 `zake6678@outlook.com` 联系方式。Cloudflare对公开邮箱做链接混淆，已只读解码核对实际地址。登录安全脚本/网络域名及第三方收银台不是本次文案隐藏范围，不声称供应商在所有网络层不可识别。
