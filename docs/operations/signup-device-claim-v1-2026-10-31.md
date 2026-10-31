# Reply Copilot｜新用户免费额度领取 V1

> 状态：已部署至 Staging，等待用户人工验收；Production 未变更。

## 目标与公开行为

- 正式/测试用户现有已领取的 200 次、新购付费额度、已结算账本全部保留，不追溯扣减。
- **仅新增注册用户**：通过邮箱验证创建账号时先不发放可用新人额度，只创建 `signup_benefit_claims(status='pending',grant_amount=当前 signup_grant)`。已购买的额度与独立活动奖励仍可正常使用。
- 新用户从现有 0.3.2 Chrome 插件按原流程打开官网、同意绑定，插件通过现有 `/v1/extension/exchange` 换得有效 session 时，服务端在**同一个 D1.batch 事务内**将安装实例登记为已领、标记新人额度已领、写 `credit_accounts / credit_batches / credit_grants / credit_ledger`。历史脚本中直接在注册时执行的 4 次入账操作被替换。
- 同一安装实例被另一邮箱注册的账号重新绑定时：**允许登录/绑定/购买/使用自己的付费额度，但不再赠送第二笔 200 次**。同一个账号换到另一安装实例/再次绑定也不再重复入账；每个新绑定的安装实例会记录为该已领取用户使用过，阻止在那台实例上再薅新用户额度。
- 同账号在全新合格的安装实例仍可领取一次其未领取的 pending 福利。清除扩展数据、重新安装等造成新安装 ID 时，有意刷号者仍可绕过；该方案是低摩擦 V1，不是唯一自然人证明。
- 既有已发放 signup grant 的老用户在此功能启用后的再次绑定只登记所用安装实例，不新增、不撤销其已有免费额度。新版本定时清理会在删除过期/撤销的旧扩展 session 前，以 HMAC 摘要持久保留已存在历史赠额的设备证据；如果迁移前的 session 已经被旧清理任务删除，则没有可信数据可追溯，不能识别这些更早的历史设备。

## 实现原理与隐私

- 新建迁移 `api/migrations/0019_signup_device_claim.sql`：`signup_benefit_claims` 记录新账户待领/已领状态、200 次额度快照与一次性 claim nonce；`device_free_claims(device_digest PRIMARY KEY, user_id, claimed_at)` 记录被已领取新人额度的账户使用过的安装实例。按 user_id 建索引，但不限制一个历史免费领取用户只能登记一台设备。
- 仅在后端用现有 `AUTH_HASH_SECRET` 进行 `HMAC-SHA256('signup-install:v1:'+lower(deviceId))`，将摘要持久化；**不新增浏览器指纹或硬件信息采集**，不向前端输出摘要或关联账号信息。原绑定流程已有 `deviceId` 与授权会话记录。
- 去重依靠 D1 `device_digest PRIMARY KEY`、`signup_benefit_claims.status pending -> granted`、`claim_nonce`。绑定、session 和四类账本写入在一个 D1 batch 原子提交；只有按 `device_digest` 的预期冲突被忽略，其他约束或数据库错误必须传播并回滚。
- 定时清理先查出将被删除的、仍能证明旧 signup grant 的扩展 session，在内存中 HMAC 后分批写入 `device_free_claims`，完成后才删除 session。任何摘要或写入错误都会中止 cleanup，保留原始 session 供下次重试。此顺序与绑定 CAS 共同避免清理竞态造成“先删证据后重领”。
- 已完成绑定但额度待领的账户允许正常账户登录和付费。注册、账户、首页、价格、FAQ 和条款页面只提供验证邮箱后连接插件的简短操作指引，不向用户展示安装实例限领等反刷实现细节；隐私政策保留对安装标识用途的必要说明。未修改 Chrome 商店插件、Manifest 或 Content Script。
- 为遵守隐私原则，device claim 数据仅用于福利反重复；记录必要账号与时间、保留在需要维护领取记录期间；请求人工核查通过现有客服邮箱。**V1 尚无专用管理员人工豁免/申诉发放操作**，不可直接手动给 pending 账户加 200 而不同时处理待领状态与账本幂等，否则未来有二次发放风险。

## 本次代码文件

- `api/migrations/0019_signup_device_claim.sql`
- `api/src/signup-benefits.ts`（新增）
- `api/src/password-auth.ts`（验证注册时挂起 200 次赠额）
- `api/src/device.ts`（exchange 时原子性处理设备去重和赠额）
- `api/src/account.ts`（/v1/usage 加 signupBenefit pending/granted，老账号返回 null）
- `api/tests/signup-device-claims.test.mjs`（新注册、同设备新邮箱、不同设备、历史会话、老账号、付费/绑定、异常回滚等）
- `web/src/components/account/AccountDashboard.tsx`、`web/src/components/auth/AuthPanel.tsx`、`web/src/pages/{index,pricing,faq,terms,privacy}.astro`

## Staging 部署记录与验收

- 代码分支：`codex/signup-device-claim-v1-20261031`；部署源码提交：`f7237bd85c2aa0ead606fb13b0b6625cf27980d6`。完整测试 710/710 通过；API 与 Web TypeScript 检查、Staging Worker dry-run、Staging 扩展构建均通过。
- Staging D1 `reply-copilot-staging`（`cd44bb44-b525-42c4-b286-2cc84dae7fdb`）先备份并在隔离副本演练，然后仅执行 `0019_signup_device_claim.sql`。Wrangler 迁移记录确认成功。迁移前备份 SHA-256：`7a4ec74da2b8587301af59b85ee3ccee8269dcac5447fc4bf786aa80c5fd59e9`；隔离恢复 `integrity_check=ok`、外键错误 0。
- Staging Worker `reply-copilot-api-staging`：新 Deployment `3efac777-7de7-4fc5-9a6a-dd5592ef2f28`，Version `2bcc9fd5-e6c0-450a-bc9c-6442bbebf44d`，100% 流量。回滚基线：Deployment `e6c42694-62c7-47e2-a78d-6fb6362dd2c6`、Version `5cb80ae9-3b02-4d8a-9048-1d539c907595`。部署使用 `--keep-vars`；Secret 值未读取，Secret 名称与 D1、Cron、支付和模型设置保留。
- Staging Pages：项目 `x-reply-helper-staging` 新 Deployment `5d460be0-9012-4a1e-b2d1-f64f16bbffb6`，部署页面为 `https://5d460be0.x-reply-helper-staging.pages.dev`；回滚基线 `da89f9eb-33da-4d35-ac90-594875b17d10`。登录页、FAQ、条款公开检查均为 HTTP 200；API `/health` 200、套餐接口 200、未认证管理员接口 401。`purchase_enabled=1`、MK99/支付宝/微信开关保持开启，模型与账户余额未改。
- 迁移后只读核对：新领取表均为 0 行；2 个账户，免费余额合计 160、付费余额合计 1021；445 条额度账本、6 笔订单、438 个 AI 请求；账户与额度批次不匹配 0。和迁移前快照一致。

## Staging 人工验收门禁

1. 用户在独立 Chrome Profile 创建已验证测试账号 A，并用现有 Staging 0.3.2 插件绑定；绑定前确认 `free_balance=0` 且领取状态为 pending，首次绑定后余额 +200，且 claim/grant/batch/ledger 各仅 1 条。
2. 同一扩展实例解绑或切换到账号 B 并绑定：绑定和登录应成功，不重复赠送；切回 A 重绑不重复赠送。账号 B 若要验证新设备领取，使用独立的新安装标识并遵守每账号只领一次的预期。
3. 验证已有账号、付费额度、生成/ACK/扣次、用户购买页和历史支付回调正常；不创建或支付订单、不发帖、不批量调用 AI。
4. 用户验收后由 Codex 对账号归属、pending/granted 状态及专属账本做只读核验。人工验收前不宣布完成，也不部署 Production。
5. 回滚时保留 0019 迁移和 pending 记录；如需恢复旧 Worker，理解旧代码不能发放 pending 额度，先修复/恢复兼容代码，不直接 SQL 加余额。
7. **回滚不撤销 0019 迁移，也不清除 pending 记录。** 代码回滚到不认识 pending 的旧 Worker 会暂时令这些账号无法通过绑定领取，但不会扣余额、删除资格或影响已购额度。先恢复兼容代码/重新部署本功能后，pending 仍可正常领取。若决定永久取消本功能，尚无已验证的批量人工补偿接口；不得直接 SQL 加余额。应先单独实现并测试由管理员审计、一次性把 pending entitlement 转成一致的 batch/grant/ledger 的补偿工具，再处理每个待领取账号。Staging 发布前应保存此方案与可用的逐账号支持路径。

## 尚未完成的人工验收

- 同一扩展实例的 A/B 双账号真实绑定、已有用户回归仍待用户人工操作并由 Codex 只读核验。
- 本轮未创建测试账号、未发送注册邮件、未发起 AI 生成、未创建订单、未付款或发布 X 内容。
- 未操作 Production D1、Worker、Pages、用户余额或商店插件。
- 未开展大量并发、换 Chrome 配置/重装滥用对抗、隐私合规正式审查。
