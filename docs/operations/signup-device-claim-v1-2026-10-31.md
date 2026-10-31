# Reply Copilot｜新用户免费额度单安装实例领取 V1（实施候选）

> 状态：**代码在独立 Git 分支，未运行完整测试、未迁移 Staging/Production D1、未部署任何 Worker/Pages/扩展。** 请将此文档当作实现与验收门禁，不是上线确认。

## 目标与公开行为

- 正式/测试用户现有已领取的 200 次、新购付费额度、已结算账本全部保留，不追溯扣减。
- **仅新增注册用户**：通过邮箱验证创建账号时先不发放可用新人额度，只创建 `signup_benefit_claims(status='pending',grant_amount=当前 signup_grant)`。已购买的额度与独立活动奖励仍可正常使用。
- 新用户从现有 0.3.2 Chrome 插件按原流程打开官网、同意绑定，插件通过现有 `/v1/extension/exchange` 换得有效 session 时，服务端在**同一个 D1.batch 事务内**将安装实例登记为已领、标记新人额度已领、写 `credit_accounts / credit_batches / credit_grants / credit_ledger`。历史脚本中直接在注册时执行的 4 次入账操作被替换。
- 同一安装实例被另一邮箱注册的账号重新绑定时：**允许登录/绑定/购买/使用自己的付费额度，但不再赠送第二笔 200 次**。同一个账号换到另一安装实例/再次绑定也不再重复入账；每个新绑定的安装实例会记录为该已领取用户使用过，阻止在那台实例上再薅新用户额度。
- 同账号在全新合格的安装实例仍可领取一次其未领取的 pending 福利。清除扩展数据、重新安装等造成新安装 ID 时，有意刷号者仍可绕过；该方案是低摩擦 V1，不是唯一自然人证明。
- 既有已发放 signup grant 的老用户在此功能启用后的再次绑定只登记所用安装实例，不新增、不撤销其已有免费额度；若其旧插件会话仍存在，可在新账号先绑定时识别曾经使用过该安装实例。授权和会话记录会被现有 cleanup 清理，因此**更久以前没有可验证记录的历史设备无法全部追溯**。

## 实现原理与隐私

- 新建迁移 `api/migrations/0019_signup_device_claim.sql`：`signup_benefit_claims` 记录新账户待领/已领状态、200 次额度快照与一次性 claim nonce；`device_free_claims(device_digest PRIMARY KEY, user_id, claimed_at)` 记录被已领取新人额度的账户使用过的安装实例。按 user_id 建索引，但不限制一个历史免费领取用户只能登记一台设备。
- 仅在后端用现有 `AUTH_HASH_SECRET` 进行 `HMAC-SHA256('signup-install:v1:'+lower(deviceId))`，将摘要持久化；**不新增浏览器指纹或硬件信息采集**，不向前端输出摘要或关联账号信息。原绑定流程已有 `deviceId` 与授权会话记录。
- 去重依靠 D1 `device_digest PRIMARY KEY`、`signup_benefit_claims.status pending -> granted`、`claim_nonce`、所有 SQL 在一个事务内；失败整体回滚授权状态/会话/赠额记录；不要单独调用 `INSERT` 在事务外。
- 已完成绑定但额度待领的账户允许正常账户登录和付费；官网账号余额页、定价页、注册页、隐私政策和条款均更新了双语说明。未修改 Chrome 商店插件、Manifest 或 Content Script。
- 为遵守隐私原则，device claim 数据仅用于福利反重复；记录必要账号与时间、保留在需要维护领取记录期间；请求人工核查通过现有客服邮箱。**V1 尚无专用管理员人工豁免/申诉发放操作**，不可直接手动给 pending 账户加 200 而不同时处理待领状态与账本幂等，否则未来有二次发放风险。

## 本次代码文件

- `api/migrations/0019_signup_device_claim.sql`
- `api/src/signup-benefits.ts`（新增）
- `api/src/password-auth.ts`（验证注册时挂起 200 次赠额）
- `api/src/device.ts`（exchange 时原子性处理设备去重和赠额）
- `api/src/account.ts`（/v1/usage 加 signupBenefit pending/granted，老账号返回 null）
- `api/tests/signup-device-claims.test.mjs`（新注册、同设备新邮箱、不同设备、历史会话、老账号、付费/绑定、异常回滚等）
- `web/src/components/account/AccountDashboard.tsx`、`web/src/components/auth/AuthPanel.tsx`、`web/src/pages/{index,pricing,faq,terms,privacy}.astro`

## 必须完成的 Staging 验收门禁

1. 从独立功能分支跑完整 `npm test`、`npm --prefix api run typecheck`、`npm --prefix web run typecheck`、`npm run build:staging`、Worker dry-run 和插件 0.3.2 向后兼容测试，特别关注 Node SQLite fixture batch RETURNING、动态价格页状态、注册时未来福利活动和老账号生成/扣费。
2. **先在 Staging D1 做 SELECT/快照并运行 0019 migration，再部署新 Worker**；若官网提示跟随更新，Staging Pages 必须由同一功能分支构建并明确核对环境。保留 Qwen、支付、后台、商家回调、SECRET 名称、既有 Origin/插件 ID，不修改 Production/商店。
3. 实测新账号 A + 插件安装实例 D：邮箱验证后 `free_balance=0`、`pending`，首次插件绑定后免费余额增加到 200、账本/批次/领额记录各 1；切换新邮箱 B 绑定 D 后仅 B 的新人额度仍 pending/0，但 B 账号可登陆且已有付费额度仍可用；B 换合格实例 D2 后获取一次，重复绑定无额外赠额。
4. 旧账户 U 绑定 D3 不加不减其原免费额度；另一新账户绑定 D3 不会再领福利。历史会话保留时能够阻止老实例抢先领取；若历史记录已清理，明确向用户说明 V1 不能追溯确认。
5. 断网/竞争/异常强制回滚测试：`extension_authorizations` 的 redeemed、`sessions`、`credit_accounts`、`credit_batches`、`credit_grants`、`credit_ledger` 必须全有或全无；确认双请求、重复兑换不能重复送额度，失败可以安全重试。
6. 对已存在的 Production 0.3.2 旧插件协议做真实 Staging 回归：绑定成功后新版 API 返回的数据维持旧字段，用户不用更新商店；不产生任何自动发布、自动付款；人工验收前不要发布 Production。
7. **切勿直接回滚旧 Worker 而保留新 pending 账户不处理**：旧 Worker 只在邮箱验证时发额，已经注册为 pending 的新账号在旧 Worker 下永远不会由 exchange 自动获得赠额。回滚或恢复方案必须包括识别 pending 账户与合规的后续兑付/手动补偿策略，不能盲目 SQL 加余额，更不能触碰已购金额。

## 当前尚未验证

- 未在本会话独立运行 npm、TypeScript、Worker dry-run 或真实浏览器测试；Github 代码提交≠测试通过；需要 Codex/CI 本地完整工作树进行门禁检查。
- 未执行 Staging 或 Production 的 D1 migration、Worker/Pages 部署，也未修改真实用户账户余额或调用模型/支付。
- 未开展大量并发、换 Chrome 配置/重装滥用对抗、隐私合规正式审查。
