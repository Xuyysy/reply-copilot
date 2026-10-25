> **历史阶段记录，禁止照其中旧测试开关/恢复Mock或占位Production命令直接执行。当前唯一发布清单为 [launch-preparation-2026-10-22.md](launch-preparation-2026-10-22.md)。**

> 运行模式已更新：Staging默认真实AI、使用后台运营预算，不再采用下文历史real-test临时限制。当前规则见 ../operations/staging-business-mode.md。

# 上线前验收与发布顺序（2026-10-22）

## 最新 Staging 支付验收（2026-10-25）

以下为 Staging 只读 D1 与 Cloudflare Workers Logs 核验结果；没有新建订单、主动查单、退款或调整额度。

| 渠道 | 结果 | 证据 |
|---|---|---|
| MK99 支付宝 | 真实支付成功；400 次额度仅入账一次 | 订单/交易均为 `paid`，实付 1059 分，`credited_at` 非空；该订单仅 1 条 `purchase_grant`（+400）和 1 个购买批次（400）。|
| RSA 异步回调验签 | 成功 | 已付款支付宝订单的真实 multipart 通知随后被 Worker 接受，`stage=acknowledged`、HTTP 200、正文 `success`。该通知对应已由主动查单写入的支付事件，因此记录为重复通知。|
| 重复通知幂等 | 成功 | 支付宝通知记录 `duplicate=true`；订单仍只有一条 +400 购买流水和一个 400 次批次。|
| MK99 微信 | 真实支付成功；首次 Webhook 自动到账成功 | 订单/交易均为 `paid`，实付 1059 分，`credited_at` 非空；真实 multipart Webhook 在 Worker 版本 `8c6afef2-831d-4c46-9c22-46340d57fb08` 被首次接受，`stage=acknowledged`、HTTP 200、`duplicate=false`。对应 D1 成功事件含非空回调规范字段 SHA-256 摘要（不保存原始请求体）。|

两笔 MK99 订单各自只有 1 条 +400 购买流水和 1 个 400 次购买批次。微信通知时间为 2026-10-25 02:10:31–02:10:34 UTC；该结账回跳监控只读取本地订单状态，不调用主动查单接口。更早的小豆易支付历史订单仍为 `paid`，+400 购买流水和购买批次各一条；没有改动该记录。

本次收尾后 Staging 保持 `PAYMENTS_ENABLED=1`、D1 `purchase_enabled=1`，MK99 及支付宝/微信渠道开关和放行状态均为开启。Webhook 保持接收。仅关闭 Staging 临时详细回调诊断；支付事件、账本和正常错误处理保留。Production 未修改。

## Production 上线阻断（2026-10-25，只读核验）

按优先级处理：

1. **P0：完成增量数据库升级和 MK99 配置。** Production D1 已存在且为空，迁移0001–0013已应用；0014–0017仍待执行。Production Worker 目前 `PAYMENT_PROVIDER=xiaodou`，MK99不能作为新单通道使用。先备份并验证恢复，再迁移；单独录入并核验 Production 商户凭证、RSA模式、金额合同、收银域名和获准渠道。购买总开关继续关闭直到全部就绪。
2. **P0：建立唯一 Production 管理员。** D1当前无用户，`ADMIN_PORTAL_ENABLED=0`。由经营者注册并验证正式账号，按稳定 user ID绑定唯一管理员，核验审计后再开启管理入口；不要复制Staging用户或角色。
3. **P1：补齐正式运行 Secrets。** 当前只存在认证、密码 pepper、Turnstile三项。需要分别为Production配置邮件、DeepSeek及MK99所需密钥；不得从Staging读取或复制Secret值。已存在的`PASSWORD_PEPPER`不得旋转。
4. **P1：确认运营与用户披露。** 完成经营主体、客服/隐私联系邮箱、隐私政策和条款的最终审阅；确认正式MK99通知地址、平台通知重试/原通知重投支持及异常人工对账联系人。Staging验证不能替代生产商户批准。
5. **P1：统一代码和商店包版本。** 现有Production Worker/Pages均能访问，但部署版本早于当前支付验收代码。迁移与配置完成后，从同一审查提交协调发布API和Pages，固定正式扩展ID/API源，并完成商店隐私披露、权限说明、截图和审核；在此之前不公开收费。
6. **P2：Production无资金验收后再单独开放购买。** 先验证注册邮件、Turnstile、CORS/登录/CSRF、普通用户真实AI额度扣减、订单/回调以及只入账一次。之后由经营者单独批准一次小额真实订单；不使用Staging数据，不由Codex付款。

Production目前`/health`和`/v1/packages`均为200，购买仍关闭；首页、隐私页和条款页均可访问，但页面可访问不代表法律内容已完成审核。此清单只依据只读资源与配置检查，没有改动Production。

## 当前结论

真实 DeepSeek 已接入，Staging历史人工测试成功；当前仍mock，不能将本次Mock验收说成新的真实AI验收。模型deepseek-flash，三种非空不同回复、JSON、finish_reason=stop，超时25秒且不自动付费重试。失败释放预占；成功生成后需插件解析及服务端交付确认才扣一次。确认丢响应可同requestId重放，不能换requestId重试付费调用。

受控真实测试复用现有 real-test，不加新系统：仅Staging/Secret指定邮箱，REAL_DEEPSEEK_TEST_ENABLED=1，AI_MODE=real-test，日应用预算和D1预算均不高于50000微美元，站点日上限10。沿用DEEPSEEK_API_KEY和邮箱Secret，不读取明文。本轮保持mock/测试开关0，不自动模型请求；部署需用完整临时配置，验证后恢复mock/0，购买运营开关保持关闭。

保守费率：输入缓存未命中0.30、输出1.32美元/百万token（2026-10-22官方Flash峰值输出1.20，目前配置偏保守）；最多1200输出token，调用前按UTF8字节上界和完整输出预算双倍预留。费用是上界估算，不宣称与发票精确一致。无缓存折扣低估。真实首测记录input/output tokens、费用、时延和CPU，不自动降低密码强度；Workers Free注册PBKDF2曾约29ms的风险仍需上线前复核。

## 从新用户到到账的人工验收

1. 新邮箱注册→验证码→登录，免费赠额仅一次200；绑定指定Staging插件，禁用旧版本避免重复实例。
2. 当前X页面：回复当前帖子/选中文本，检查原帖识别，媒体/上下文不足不编造；三种草稿；中英、长度、语气、bold、自定义样本生效。
3. 先Mock连续5次；每次三条、确认交付后只扣1，账本5条。上游失败/格式错误/交付失败验证无额外正式消费；重试原requestId不重复调用模型或扣费。免费→legacy付费→新付费FIFO。
4. 用户选择并插入草稿，X发布按钮保持未触发；手动改字、关闭面板、切换帖子、自动建议开/关均不自动发帖，不自动批量回复。
5. 插件和账户页聚焦后余额同步。浏览器Fixture通过不等于最新真实X DOM实测，发布前本人在真实X完成以上步骤。
6. 受控real-test只用指定账号手动1次；检查输出、费用、CPU、扣1，失败不循环重试；随后恢复mock。真实API余额由本人在DeepSeek后台确认，不自动充值。
7. 购买前核对美元参考价、费率、最终CNY：400次9.90+0.16=10.06，1000次19.90+0.31=20.21，2000次32.90+0.51=33.41。以服务端/订单不可变快照为准。
8. 已有真实付款Staging证据：10.06元→一个400批次/一条购买流水。新真实测试只能由本人付款，本轮不再付款；关闭购买后通知仍可入账。回跳/截图非证据，轮询只查本地订单，不主动平台查单。
9. 漏通知按payment-incident-runbook.md核实、官方重投、只读一致性审计。无法重投且无可信查单时不手工补单，先确认平台支持再公开收费。

## Production 实际阻断与安全顺序

- 仓库Production仍有占位D1 UUID、WEB/API域名和扩展ID，支付provider仍旧RSA2、未配置模型成本费率；check:production应失败，不部署此默认配置。
- 先本人确认正式站点/API域名、商店条目ID及公开公钥、经营者与客服资料/隐私政策，确认平台正式通知域名与重投支持。
- 创建隔离Production D1/Worker/Pages并核实归属；空库0001–0012顺序迁移，**不复制Staging账号/余额/订单/会话**。本轮不执行。
- 单独配置AUTH_HASH_SECRET、PASSWORD_PEPPER、邮件、Turnstile、DeepSeek及易支付三项Secret；无需向聊天发值，已有库不得旋转pepper。Production唯一管理员由正式现有账号稳定ID单独绑定，不能复用Staging ID。
- Production采用xiaodou_epay，明确真实AI模型/费率、应用日美元预算和站点上限；先保持购买关闭。原子数据库purchase_enabled=0和环境紧急开关双重关闭，不能复制测试开关。
- 先Worker后Pages，检查域名TLS、CORS/稳定插件origin、身份/CSRF、无签名notify401、健康/套餐、数据库一致性，保留备份与版本。不要把Staging清理/回滚当作Production方案。
- 本人完成真实X、隐私政策/商店审核及真实AI验收，再单独批准Production发布和首次正式小额付款。核对通知、唯一批次/账本、自动余额同步。
- 异常立即关闭新购买/AI，保留回调和数据；恢复兼容代码，不回滚财务数据、不删除UNKNOWN。不以后台普通赠额代替支付账本。

本轮不会实际创建Production资源、迁移、改Secret、付款退款或发布商店。

参考：https://api-docs.deepseek.com/quick_start/pricing/


## 本轮执行证据

- 全项目397/397测试通过；API/Web TypeScript、Staging配置和Worker dry-run通过。
- 隔离真实Chrome冒烟通过（页面、设置同步、状态切换、过期请求隔离）；toolbar action在该自动化目标上返回“Action can only be triggered on a tab target”，因此不声称工具栏点击验证通过。该测试没有真实X发帖。
- 完整本地Worker+D1 E2E通过：赠额200、连续5次后195、交付重放、过期释放、账本一致、并发仅1个成功、Mock支付400一次、冻结身份失效、密码重置、在途预算拒绝均通过。旧E2E夹具补充唯一管理员绑定、重新认证及操作ID；冻结会话按现有401合同断言，没有降低权限或改业务代码。
- Staging Worker `9828b824-7b71-4a3c-ac33-db1ed270bf94`，远端100%流量；/health200、/v1/packages200。
- 远端AI_MODE=mock，真实AI测试0，站点日上限10，D1预算50000微美元，管理员后台1，Webhook1，16项Secret和原D1完整。
- 只读发现purchase_enabled已为1，paymentAvailable=true；本轮没有开启/关闭购买，没有创建交易。保留经营者当前设置，不能沿用上轮“购买关闭”的旧报告。
- 部署前后：2用户、3订单、3尝试、1事件、0退款、20账本，免费总额400、付费总额400一致；四项只读财务审计anomalies均0。
- 当前账号按Reply Copilot Production命名的Worker、Pages、D1均未找到；不证明其他名称的资源不存在。源码Production占位配置仍阻断发布。
- Staging插件构建在dist/staging；未提供商店公钥，本次构建不能宣称ID已固定。
- 本轮无远端迁移、无真实AI/平台查单/支付/退款调用、无Production修改、无Git提交或推送。
- Pages `9e185c17-2aa6-4c97-8dc2-ce347e2cbc0f`远端success；/terms/与/privacy/200，已确认新文字生效。本轮仅修正“付款尚未开放”的过时说明和定时清理描述，未发布最终经营者法律声明。
