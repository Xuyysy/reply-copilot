> **历史阶段记录，禁止照其中旧测试开关/恢复Mock或占位Production命令直接执行。当前唯一发布清单为 [launch-preparation-2026-10-22.md](launch-preparation-2026-10-22.md)。**

> 运行模式已更新：Staging默认真实AI、使用后台运营预算，不再采用下文历史real-test临时限制。当前规则见 ../operations/staging-business-mode.md。

# 上线前验收与发布顺序（2026-10-22）

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
