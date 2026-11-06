# 互动势能临界值 V1：实现与验收候选

状态：代码、隔离测试和独立 Staging 包准备完成；**未部署、未覆盖已安装插件、未作真人 X 验收**。

需求全文来源：Notion https://app.notion.com/p/410c089052a3810d9981fea43980fabe 。本轮用户明确要求服务端可信购买权益、后台管理，优先于早期文档“仅改插件”的建议。

## 基线证据

- 功能分支：`codex/creator-momentum-v1-20261106`，从实际 Production Worker/Pages 已发布源码 `3cebe3ecbee552ef5b0e68afc7882a2dfb3869fa` 增量开发。
- 参考正式插件源 `codex/production-pr16-release-20261105` 的远端 HEAD 为 `0b194c27df5c659331d6e4f01f3fa6b1a180bd99`；没有从 main 覆盖生产成果。开发开始时 main 为 `72a4ac506944506d0093f1721bc80b806f214b1f`，不是此功能的生产发行基线。
- 从 Google 官方更新接口公开下载实际商店 CRX，manifest **0.3.3**、四项权限、原商店 ID `fgfjajofkapebgphfidblngcjomkbdaj`。CRX SHA-256 `abddee54459eefa9133015b2650e8c0aeb6b605795e6630504280e63aa1a1cf9`。
- CRX 中 43 个源码 JS/CSS/HTML 文件与固定 Production 父提交逐字一致，包含 delivery coordinator 和 background；runtime 是正式构建生成文件，不能拿开发 runtime 直接比较推断不兼容。
- 没有修改 Production/Staging 环境，没有手工执行线上或数据库副本 SQL、migration、支付/模型/额度配置或商店操作。

## 实现范围

1. `domain/creator-momentum.js`：独立配置校验、自然日、固定当日三阶段、最高未提示阶段、最多三次、90 分钟以上冷却、免打扰。
2. `services/creator-momentum.js`：ACK receipt outbox、IndexedDB 日聚合和精确 requestId 去重、按账户偏好、原子提醒占用。没有依赖最多 1000 条 usage/100 条 history 的保留窗口。
3. 原 normal delivery 的 storage.get/set **次数不增加**。动态当前 requestId outbox key 并入已有 get；小型 outbox 并入 receipt/history/usage 的已有 set。首次 ACK 日期/策略不可被跨午夜重放覆盖。
4. 计数事务只处理一条 event + 一个 day 记录；无全历史扫描。正常完成后才聚合/提醒。每次恢复处理最多 64 个 outbox，后台恢复最多 32 批并且有持久重试；本地 seen/day 数据按 32 天窗口有限维护，早于窗口的旧事件不重新计数。服务端原结果重放有效期远小于此窗口。账户 prefs 独立保留。
5. 已 ACK 但进程在本地聚合前结束，outbox 随原成功提交保存，下一次功能状态读取恢复；聚合成功、删除 outbox 前中断时去重事务防止重复计数。已完成服务器确认但丢失本地 envelope 的显式恢复也保存小型 receipt；失败、未 ACK、无效输出不记成功。
6. 侧栏在既有历史写入中附加 ACK outbox，展示后才触发非阻塞聚合；不改侧栏的服务端生成/ACK 协议。
7. `content/momentum-presenter.js` + 既有浮窗：独立滑动开关，免费锁定、显著的专业介绍/套餐按钮、付费账户默认 OFF；不改“自动生成建议”。介绍按需创建，明确当前 V1 与未来 X 公开推荐、互动建模、中文榜单/曝光、动态策略研究的边界。无实时曝光/榜单采集或曝光保证。
8. 达标只占用最高阶段，不连弹；普通 × 关闭当前提醒、今日免打扰持久化、OFF 继续计数、重新 ON 可补最高未提示阶段。编辑器不失焦，不自动发帖；“去发布原创帖”仅由用户点击打开固定 X compose URL。
9. `api/src/creator-momentum.ts`：现有权益接口附加 `features.interactionMomentum`；后台读取、保存、历史恢复和 Staging-only 模拟。`CreatorFeaturesPanel.tsx` 复用现有 AdminDashboard Tab、二次确认、原因和密码 reauth 流程，全部中英文。

### 权益规则

只读检查当前 active、未归档用户的真实已付款、已入账订单：transaction paid/paid_at、clear 风控、真实非 Mock provider、有 provider trade ID、对应正数 purchase_grant 账本、未全退本金；进行中/未知退款及批次人工审核/退款预占阻断资格。**不查看 paidRemaining 作为证明**。

- 单纯管理员赠额或免费额度不会解锁。
- 合法真实购买的额度耗尽仍可解锁。
- 全额退款/交易已退款/冻结/异常订单不解锁；有别的有效购买时仍可资格通过。
- 部分退款仍有未退本金、且无未决退款/风控时可保留资格；批次剩余数量为零不是撤销购买证明。
- 权益或配置暂时不可用：锁定本功能，原 AI 回复继续；不错误提示已付费用户再次购买。

权益与配置随**已有**账号预检返回。旧服务器没有新字段时安全锁定，不追加循环请求。独立功能缓存 60 秒；仅回复已展示/填入后或用户主动查看介绍、切开关时才允许按需后台刷新现有账户接口。初始普通回复不为新功能发起额外资格 HTTP，也不 await 功能刷新。

### 配置/数据库

不需要新表、索引、迁移或 Secret。

- 新命名空间 `system_settings.creator_momentum_v1`，无记录时采用全局 OFF 的安全默认值；初始化由未来获授权后的管理员保存 API 完成，不执行手工 SQL。
- 版本为管理员 operation UUID。使用既有 `admin_operations`/`admin_audit_logs` 保存完整前后配置、原因和历史；回滚写一个新版本，历史不删除。
- 预期版本 + 原始值比较：并发冲突使同一 D1 batch 原子失败，operation/audit 一起回滚，不能静默覆盖。
- GET 需管理员身份；保存/恢复/模拟需管理员 CSRF、最近密码 reauth、20次/分钟限流。模拟仅 `ENVIRONMENT=staging`，以纯策略模拟计数，只返回预览，不调用模型、不改额度或插件真实统计。
- paid-only 为代码固定规则，没有“免费开放”开关。阈值阶段不重叠、数字有界、次数 1–3、冷却 90–1440 分钟、双语文案长度/类型校验。内容按纯文本显示。
- 当天首次初始化固定阈值、规则版本、上限、冷却；普通参数次日生效。全局暂停和文案在后续既有权益刷新生效，不停止计数。

## 测试与性能证据

最终完整 `npm test`：**853 pass / 0 fail / 0 skipped / 0 cancelled**。API/Web TypeScript 与显式 Staging Worker dry-run 通过。最后一次样式完善后，真正 375 CSS 像素的插件/后台 UI 两项浏览器测试另行通过。

覆盖：免费/付费、赠额/余额耗尽、退款/冻结、配置鉴权/CSRF/reauth/冲突/审计/回滚、1,500 条 ACK、并发重复、跨账号、OFF/ON、多个阶段、冷却/日上限、今日免打扰、跨日、时区/DST/回拨、事务中止、重启前未聚合 outbox、删除 outbox 失败后的重试、ACK 失败、上游失败/无效格式、旧服务器兼容、原 PR16 恢复/ACK/账本/草稿保护、原 Issue18 支付及 #17 注册。

真实浏览器：临时无登录 Profile，使用实际 IndexedDB 和浮窗/后台组件。没有控制用户 Chrome/X。界面截图来自合成页面，没有用户邮箱、帖子、Token 或订单。

完整路径 A/B 从固定 Production Git archive 构建基线，交替执行内容脚本→后台→Hosted→模拟 Provider→ACK→展示/填入，包含绑定、冷账号预检、历史、Voice Profile；个性化上游 prompt body hash 一致。每版本 12 个记录样本（另有 warmup），时间阶段包含关系保持，不能把 ACK 再加到全程上。

另有真实隔离 Chrome 的四场景交替 A/B：付费 OFF、付费 ON 未达标、达标提醒、免费锁定，每版本每场景 12 样本，共 96 个记录样本；实际合成编辑器接受 insertText，提醒绘制在已记录填入之后。

完整原始报告：`full-path-performance.json`、`native-browser-performance.json`。这是 **Mock 模型/合成 DOM 和网络/D1 延迟**，不是实际 X 或供应商性能，不能声称已经完成真实 X 验收，也不能据此保证真实模型 3 秒响应。

- 正常热路径 generate + ACK 始终 2 次，新增恢复 HTTP 0；阻塞存储读/写次数不变。
- 完整冷启动路径两版均为原有 3 次账户预检 + generate + ACK（共 5 次），无每条新增付费资格查询。
- 原 Fast Path、异常恢复和财务不变量保留；没有改提示词、Voice Profile、输出解析器、composer 关联和原生输入实现。
- 样本未出现明显回复速度回退；毫秒级计时波动如实保留，不宣传提速。真实 X、真实服务器权益查询开销、长期使用和 MV3 实际强制终止仍需 Staging 真人验收。


### 本轮完整路径实测（毫秒，12/版，合成环境）

| 指标 | 基线均值 | 候选均值 | 基线 P50/P90 | 候选 P50/P90 |
|---|---:|---:|---:|---:|
| 点击→三候选显示 | 156.9 | 156.4 | 157.0/158.6 | 155.9/159.3 |
| 点击→编辑器填入 | 238.3 | 237.5 | 238.7/239.5 | 237.4/239.3 |
| ACK（已包含在总耗时） | 24.5 | 24.5 | 24.7/24.8 | 24.8/24.9 |

## 独立 Staging 包与身份约束

构建目标只在当前功能 worktree 的 `dist/staging`。正式安装包、现有 Staging 加载目录都未覆盖。

当前真实 Staging ID `kaaehkpihjenlhjjfjcopkjhegmfmchk` **不是 RSA key 固定的**：Chrome 只读本地扩展元数据和安装 manifest 均无公钥；原路径 `/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging` 的 SHA-256 派生 ID 正好匹配。

因此：**不得直接把当前 worktree 的新目录加载成另一个同身份扩展，也不得生成 key。** 如未来授权安装，先备份原目录，在原路径替换文件，Chrome 重新加载原扩展，storage/账户授权不清除；只允许同路径验证。此时才能确认实际运行该候选。ZIP/manifest 的名称本身不能证明当前 Chrome 已加载它。

ZIP 根目录是 manifest，版本 0.3.3 的独立 Staging 测试候选，网站/API 为 Staging、无 debugger、无新权限。不是 Chrome 商店上传包。实际商店已为 0.3.3，未来正式更新必须另行授权并提高商店版本。

## Staging 人工验收（下一阶段授权后）

1. **本轮未部署。** 首先获准将有限后端/后台补丁集成到真实最新 Staging 源码并发布 Worker + Pages，不能整份把 Production 功能分支覆盖 Staging。重新核对当前 42 项绑定、双区域预设、模型、Secrets、购买开关、域名、Cron、现有 UI；只移植 creator 模块、account entitlements 字段、index 路由和 AdminDashboard 小入口。无需 SQL/migration，不换模型、不真实付款。
2. 后台进入“创作者功能”，检查默认全局 OFF、固定 paid-only、三阶段/90分钟、完整双语介绍。填写操作原因，按原机制重新验证密码，保存；刷新确认版本。模拟各阶段，确认只是预览，没有 AI 调用或额度变化。更改后可恢复之前版本/初始默认。
3. 使用现有真实已购买测试账号和免费测试账号；不要用管理员赠送付费额度伪造购买资格，不创建新收费订单。
4. 授权安装后备份原 Staging 目录、同路径替换候选并重新加载原扩展，再刷新 X。检查原 ID、账号、正常回复、四项权限保持，不能卸载或清空 storage。
5. 免费：入口和专业介绍可见、滑动开关锁定、套餐入口可用，生成仍正常且后台本机计数增加。付费：开关默认 OFF，关闭也计数；开启后按资格监测。勿真实生成几百次；规则触发靠管理员 Staging 隔离模拟和本地自动测试验证。
6. 正常生成、已有草稿保护、连续帖子、恢复/放弃、切换账户、重开 Chrome；自然日及免打扰等复杂场景已有合成回归，真人不要改系统时间或批量调用模型去凑阈值。真实 X 由用户亲自验收，Codex 不发布评论。

如需检查一次真实生成的本机累计，可在 Staging 扩展 Service Worker 的可信 Console 中执行下方仅本地统计诊断；HTTP 仅复用现有账户读取，不打印 Token/邮箱/帖子。它会把已有 ACK outbox 聚合进本地计数，不调用模型、不改财务。不要在 X 页面 Console 执行：

```js
(async () => {
  const [{AccountClient}, {MomentumStore}] = await Promise.all([
    import(chrome.runtime.getURL('services/account-client.js')),
    import(chrome.runtime.getURL('services/creator-momentum.js')),
  ]);
  const client = new AccountClient();
  const [account, entitlement] = await Promise.all([client.fetchCurrentUser(), client.fetchEntitlement()]);
  if (!entitlement.features?.interactionMomentum) return {available:false};
  const store = new MomentumStore();
  await store.drain(chrome.storage.local);
  const value = await store.view(account.user.userId, entitlement.features.interactionMomentum.policy, {eligible:false});
  return {day:value.day, confirmedGenerations:value.count};
})()
```

## 回滚、限制及未来 Production 门禁

- 本轮没有安装或发布，现有产品无需回滚。未来先关闭新功能全局提醒可保留正常生成；如需代码回滚，先还原原 Staging 插件目录并重新加载，再回滚新增后台/Worker，保留新设置和审计数据，不改任何余额/订单。旧代码忽略这些配置；本地统计保留供未来恢复，不卸载/清 storage。
- 本地数据不跨设备、不补算升级前历史；卸载/清除扩展全部数据将重置。浏览器存储完全不可写时不可能保证精确永久持久化，功能暂停/重试而不拖慢或阻止原回复。
- 提醒先原子占用阶段再展示，避免多标签/重启重复；若进程恰在占用成功但显示前终止，可能少显示一次提醒，不会重复发信号，更不影响额度或回复。
- Staging UI/Worker 尚未上线，当前线上旧 API 会使新功能暂不可用，这属于预期安全降级，不应误说用户没有购买。
- 下一步需用户批准 Staging 增量部署与同路径插件替换并真人验收。Production Worker/Pages、正式插件、商店发布仍需单独明确授权；没有新增 Secret 或迁移前置条件。
