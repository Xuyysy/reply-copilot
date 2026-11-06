# 互动势能临界值 V1 Implementation Plan

**Goal:** 在既有正式插件基线上提供付费提醒、免费可见介绍、独立每日 ACK 计数和安全后台配置，正常回复无新增网络等待。
**Spec:** Notion 410c089052a3810d9981fea43980fabe（全文已读取）及本轮用户明确实施要求；新要求优先于文档早期“只改插件”的范围。
**Architecture:** 既有权益接口附带可信购买资格和受控配置；复用 system_settings/admin_operations/admin_audit_logs，不新建表。ACK receipt 的既有一次 storage.set 附带小型持久 outbox；回复展示后将事件写入 IndexedDB 原子去重/日聚合，Worker 重启时恢复 outbox。规则、存储、展示解耦。
**Tech Stack:** MV3 JavaScript、IndexedDB、Cloudflare TypeScript/D1、React 后台；无新运行依赖或权限。

## 基线与边界
- 当前 Production Worker/Pages 发布源码 3cebe3ecbee552ef5b0e68afc7882a2dfb3869fa；其插件关键文件与 0b194c27 一致。
- 公开 Chrome 商店实际下载 0.3.3 CRX，delivery-coordinator 和 background 源码与本分支父基线逐字一致；不能仅凭分支名判断。
- 独立分支 codex/creator-momentum-v1-20261106，复用现有隔离 worktree。Issue18 已提交发布内容完整保留。
- 不部署、不运行线上/副本 D1 SQL、不修改支付/额度核心、不重新打包或覆盖现有正式/已验收 Staging 安装。准备独立 Staging 候选文件。
- 所有统计为本机当日 ACK 成功生成数，不是已发送评论数，不跨设备；升级前历史不猜测补数。
- 默认监测关闭；仅付费、用户 ON、全局 ON、非今日免打扰可提醒。每次只取最高未提示阶段，每日<=3，冷却>=90分钟；每天阈值固定，普通参数次日生效，暂停及权限失效及时生效。
- 有效真实结算购买（包括额度用完）可用；赠额/Mock不授予。全额退款、冻结、未结算/风控不授予；部分退款存在未退本金且无进行中退款时可保留。资格错误只关闭提醒，不影响生成。

## 实施任务
- [x] 1. 测试驱动规则模块：本地自然日、固定三档、最高阶段、冷却、免打扰、时钟回拨/时区切换。
- [x] 2. 原子 IndexedDB 聚合/去重、账户偏好、ACK outbox 与既有 receipt 合并，重启恢复、存储失败隔离。
- [x] 3. 既有 entitlements 扩展与真实订单权益、受控配置 CRUD/审计/乐观并发/回滚、Staging 无写入模拟。
- [x] 4. 浮窗独立开关、显著专业介绍、付费锁定/套餐、非阻塞提醒；保留原自动生成开关与编辑器机制。
- [x] 5. 管理后台轻量独立 Tab、双语参数/文案/预览/版本/回滚，复用确认/reauth。
- [x] 6. 完整回归、真实隔离浏览器 IndexedDB/UI、相同基线 A/B 展示/填入 P50/P90/HTTP/ACK；准备独立 Staging 插件候选与验收说明，提交分支，不部署。

## Review Focus
- 免费也计数、恢复/重放仅计一次，统计失败不可让原回复失败。
- 账户切换及迟到异步回调不可污染另一个账户或抢占编辑器。
- service worker 在 ACK 后及计数落盘前终止时 outbox 可恢复。
- IndexedDB 事务并发精确去重，不能依赖最多1000条 usage 历史。
- 旧服务器缺少新字段安全锁定，后台并发保存/恢复不得覆盖新版本。
