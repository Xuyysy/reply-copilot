# Issue #18 Production 最小集成候选（未部署）

状态：仅准备与本地隔离验证完成。Production / Staging 未部署，未执行任何在线或恢复副本 D1 SQL；未创建真实订单或调用付费模型。下一阶段须用户单独授权。

## 1. 两份线上基线，不能互相替代

2026-11-06 通过 Cloudflare 只读部署/配置元数据重新核实：

| 组件 | 当前线上基线 |
| --- | --- |
| Production Worker | `reply-copilot-api-production` |
| Worker Version / 100% | `ed4402fa-a80a-42d8-adec-8066cd914b95` |
| Worker Deployment | `b4f9b9fb-a2b7-41ff-a641-2471d925f5bf` |
| Worker source | `0b194c27df5c659331d6e4f01f3fa6b1a180bd99` |
| Production Pages | `x-reply-helper-production` |
| Pages Deployment | `4c13744f-070e-4c59-aa5d-27b20650f74f` |
| Pages source | `540b8944c310cdecbc2b7358a63c04b5e937834c` |

证据：Worker settings 的 `workers/commit_sha`、部署注释均指向 `0b194c27…`；Pages canonical deployment 的 commit metadata 为 `540b8944…`。不是依据 main 推测。

从 Worker `/content/v2` 提取 `index.js`，433150 bytes，SHA-256：

`30c6a3728354ed0ad30327ab17f8edd84e889454f7f2687098b1fd26bcdeb1b1`

用 clean `0b194c27…` 源码、Wrangler **4.151.0**、compatibility date **2026-10-14**、flags `[]`、未压缩 ESM dry-run，得到逐字相同 SHA-256。原始上传包也与之相同。构建保留源路径注释；为字节复现，使用原发布 worktree 的绝对入口，并在 `/private/tmp` 执行：

```sh
WRANGLER_LOG_PATH=/private/tmp/issue18-production-candidate/wrangler.log \
node '/Users/xuyaoyang/x posst/apps/reply-copilot/api/node_modules/wrangler/bin/wrangler.js' \
deploy --config /private/tmp/pr16-production-live.json --dry-run \
--outdir /private/tmp/issue18-production-candidate/exact-baseline-tmp
```

该私有配置 main 指向 `/Users/xuyaoyang/.codex/worktrees/production-pr16-release/reply-copilot/api/src/index.ts`；`keep_vars=true`、`vars={}`、DB 为现有 Production ID。没有读取 Secret 值，没有网络发布。日志和原产物只留本机私有临时目录。配置文件不是可直接上线的完整部署配置。

### 候选组织

分支 `codex/production-issue18-candidate-20261106` 从实际 Worker `0b194c27…` 建立；先同步 **已经在线** 的 Pages `540b8944…` 的 web 目录，然后逐项迁移支付功能。没有整分支合并 Staging。

因此相对 Worker 父提交会看到十个 Issue #17 Web 文件；它们不是新增或未经批准的功能，而是当前 Pages 的既有修复。审阅支付前端应对比 `540b8944…`，审阅 Worker 应对比 `0b194c27…`。

参考已验收 Staging 支付源 `1047e0494ae9776f884ec935875f5aeabfb06227`（Pages）和 `ce15c4e3be31c1a628f06473647d87f3f3d9b5c4`（Worker）；没有迁入 SiliconFlow、新 AI 配置、其他后台功能或 Staging migration。

## 2. 仅支付相关增量

- `api/src/account.ts`：订单列表附加 `risk_state`、`paid_at`、`credited_at`。只增加字段，不改原有返回字段和排序。
- `api/src/payments.ts`：未确认订单拦截增加 `package_id` 范围；仍保留用户、协议/商户、原子 INSERT 条件及原有 restart 限制。不同套餐独立创建，同套餐仍阻止并发重复下单。
- `getOrder()` 保留订单归属，读取已入账证据，按当前 MK99 allowlist 重新检查原 HTTPS URL；非 pending、非 clear、已有支付/入账/账本/批次证据时不返回链接。原链接字节、原金额和原交易号不重建。
- `AccountDashboard.tsx` + `payment-resume.mjs`：仅符合资格的 MK99 订单显示继续支付。GET 原单 → 现有可信 `/refresh` → GET 最新原单；要求 authenticated HTTPS query 证据、pending/clear、未支付/入账及 URL 不变，然后跟踪原单并导航原收银台。全过程不调用 create/attempts。
- `cashier-navigation.mjs`：原单恢复单独使用受检原 URL 和原生链接隐私属性；不与普通新购共用异步跳转路径。
- `payment-sync.mjs` + Account：支付横幅 × 整条条件移除；按账户、订单、事件保留关闭状态；语言、轮询不重现同事件，新事件可显示，账户切换不会泄露上个账户提示。只影响 UI，不停止到账同步。
- `checkout.astro` + `checkout-resume.mjs`：保持原页面 UI。显式套餐不被 remembered old order 替代；MK99 新单创建后读取最新归属订单，以最新快照确认链接。打开普通新购收银台时保持原生 `<a target="_blank" rel="noopener noreferrer">`，同步检查后默认导航，**点击时不执行异步查单或 location.assign**。既有原单 locator/手动刷新读取最新状态并 fail closed；Epay 表单与恢复机制保持。

不新增 API、不新增 migration。未改 MK99 create 参数、签名/回调、结算、金额、额度账本、实际订单状态。

## 3. 保护边界与配置

逐字比较确认以下与 Worker `0b194c27…` 一致：AI 调用、quota、认证、MK99 实现、delivery coordinator、hosted client、background service worker、prompt builder、output parser、manifest；迁移及 Wrangler/deploy 配置无改动。

六个注册模块与 Pages `540b8944…` 逐字一致：AuthPanel、api.ts、language.ts、request-timeout、turnstile-controller、login.astro。

本轮只读取 Cloudflare 元数据及公开登录 HTML；没有 D1 SQL，也没有读取 Secret 值。

### 实际线上配置（部署前须再次读取）

- 30 bindings：20 plain_text、9 secret_text、1 D1。
- `PAYMENTS_ENABLED=1`、`ADMIN_PORTAL_ENABLED=1`、`AI_MODE=production`、`ENVIRONMENT=production`。
- `WEB_ORIGIN=https://app.x-reply-helper.top`、`API_ORIGIN=https://api.x-reply-helper.top`。
- `EXTENSION_ORIGIN=chrome-extension://fgfjajofkapebgphfidblngcjomkbdaj`。
- D1 `DB=d9df7d23-9b9c-44ac-a33a-c24474c15691`；未查询数据库。
- Cron `0 3 * * *`；无普通 Worker route，custom domain `api.x-reply-helper.top` enabled，previews false。
- MK99 API/cashier origin `https://mk99.cn`、amount contract `CNY_EXACT_BUYER_TOTAL`、request/notify sign RSA、protocol confirmed 1。
- 其余 plain variables：DeepSeek input/output 历史费率、disposable email domains、MAIL_FROM、PAYMENT_PROVIDER、XIAODOU_RETURN_URL、XIAODOU_WEBHOOKS_ENABLED 均保留。环境中 legacy PAYMENT_PROVIDER 不代表当前数据库商户路由；本轮未读取/更换当前模型或商户。
- Secret **名称而非值**：AI_CONFIG_ENCRYPTION_KEY、AUTH_HASH_SECRET、DEEPSEEK_API_KEY、MAIL_API_KEY、MK99_PID、MK99_PLATFORM_PUBLIC_KEY、MK99_PRIVATE_KEY、PASSWORD_PEPPER、TURNSTILE_SECRET_KEY。
- 仓库旧 production config 的 PAYMENTS_ENABLED=0 仍不可信；本候选没有尝试改它或运行原部署脚本。

Production Pages 构建使用：

```sh
PUBLIC_API_BASE_URL=https://api.x-reply-helper.top \
PUBLIC_TURNSTILE_SITE_KEY=0x4AAAAAAFhsvhYsTlFR6LIM \
npm --prefix web run build:production
```

Site Key 来自线上公开 `/login/` HTML（公开配置，不是 Secret）。最终 HTML/JS 含正式 API/该 key，不含 Staging 域名和 Staging key。Pages 项目 env metadata 为空，不能据此假定下次自动构建会注入这些值。

## 4. 实际验证结果

- 首轮完整测试发现两处旧断言：显式套餐仍期待恢复历史订单；刷新按钮禁用条件未包含继续支付中状态。分别迁移已验收的正确测试输入及更严格禁用断言，没有跳过/删除安全断言。
- 最终完整 `npm test`：**828 pass，0 fail，0 skipped，0 cancelled**。
- API `npm --prefix api run typecheck`：通过。
- Web `tsc --noEmit -p web/tsconfig.json`：通过。
- Production Pages 构建：12 个页面，通过；全测的 Staging 构建结束后单独重建，避免交付测试构建产物。
- Worker dry-run：通过，434885 bytes（424.69 KiB），没有上传。
- Mock 支付 API：URL/归属/支付风险、已到账证据、跨套餐、同套餐并发、防重复、网络未知、可信关闭、晚到重复回调只入账一次；原 Epay、免费/付费额度及 PR16 全套回归均通过。
- 实际隔离 Chrome：375px/桌面、中英文、通知 × 键盘关闭、跨账户、继续支付重复点击、普通套餐及旧单状态、latest URL/paid 快照、Epay、注册验证恢复。
- 合成 HTTPS 收银台浏览器对照：原版/候选为新标签页、无 Referer、无 opener、点击时无查询；回归版同标签页并携带 origin Referer，且顺序查单。**没有访问真实 MK99 收银台或绕过平台审核。**
- 新 Pages 遇到缺少 `paymentCashierOrigin` 的旧 Worker 返回时拒绝继续支付而非猜测可信来源；旧返回字段仍保留。真实旧客户端/真实商户端到端尚需发布阶段人工验收。

本轮没有执行真实支付，没有宣称商户域名/网关审批已重新核实或真实付款已成功。Issue #19 的历史真人验收来自已阅读的 Issue 记录，不能替代本候选的正式验收。

## 5. 本地构建交付

本机 `/private/tmp/issue18-production-candidate/artifacts/`（临时目录可能被系统清理，正式发布必须固定候选提交重建）：

| 产物 | SHA-256 |
| --- | --- |
| `production-worker.js` | `633e3d1f63214a5709644ed400ee928086f23c3bb6b19bc0b436d54becfe9a1a` |
| `production-pages.tar.gz` | `1567931d8eff5470fc609ce1ed23a4e254865859c326d0d30d847739600e4191` |

Worker 注释包含候选 worktree 路径；换路径构建可能改变字节 hash。Pages 压缩包时间戳也会影响重建 hash。源提交、环境、工具版本与文件清单应同时固定，不能只比较路径敏感的单一 hash。

## 6. 下一阶段预发布、发布与回滚方案（尚未执行）

1. 用户授权发布本候选的 **Production Worker → Pages**；包含受控用户手动支付验收时须明确是否允许新建真实订单/付款。本阶段未获这些权限。
2. 发布前再次核实 Worker/Pages 当前基线。若已漂移，先增量再整合，不能覆盖；重新记录 30 项 bindings 的类型/公开值/Secret 名称、DB、Cron、custom domain、安全设置与可用回滚版本。
3. 固定候选提交重跑必要门禁与正式构建。创建完整的私有 live-derived Worker 配置；普通变量、D1、Cron、自定义域名、安全设置逐项继承，Secrets 只保留名称/引用，**不得从旧仓库生产配置直接 deploy**。`--keep-vars` 不替代其他绑定核对。
4. 可以先上传不切流量 Worker version，在版本 metadata 核实 bindings 与 live 完全一致；确认后发布 Worker 100%，记录新 version/deployment。无 migration。
5. Worker 健康、未鉴权接口、旧 Pages 契约与支付开关检查通过，再发布同提交的正式 Pages，显式注入已确认的 API/key。只发布现有项目，不改变域名/Secret。
6. 人工登录现有账户：注册组件正常、账户刷新/通知关闭、中英文和窄屏；有现存合格待付款原单时继续支付只到原 URL，无新交易。普通新购需额外授权真实订单/付款；不为 UI 验收自动创建订单。不同套餐/重复回调的账本证明本轮为合成数据，不冒称线上已验证。
7. API 返回未知、manual review、已付款/已关闭、merchant domain 审核报错时立即停止；不得自动换 URL/伪装来源/新建交易。平台审批问题仍需真实商户侧确认。

### 成对回滚：先 Pages，后 Worker

- 先通过 Pages 官方 rollback 将现有项目退到 `4c13744f-070e-4c59-aa5d-27b20650f74f`，确认旧 Pages 恢复。
- 再将 Worker 流量退到 `ed4402fa-a80a-42d8-adec-8066cd914b95`，保持全部原 bindings / Secrets / Cron。
- 若发布前基线变化，使用当时重新固定的成对回滚目标，不沿用这里的过期 ID。
- 新后端兼容旧 Pages，故发布先 Worker；新 Pages 的安全原单恢复依赖新增字段，故回滚先 Pages。浏览器旧缓存仍可能持有新 JS，此时缺字段 fail closed，不跳收银台，提示刷新/重试。
- 本候选不改 schema。回滚仅切换代码/流量；不删除订单、撤回额度或恢复旧数据库覆盖新交易。不同套餐发布期间已经产生的合法订单仍各自独立；旧 Worker 可能恢复更严格的创建拦截，不影响真实回调的原有幂等结算。

## 7. 尚未覆盖、下一阶段门禁

- 未做本候选真实支付/商户审核和登录后的 Production 真人验证；用户亲自完成。
- 未执行任意线上 D1 SQL，因此没有宣称已对真实订单/余额逐笔核账。
- 未操作 Production / Staging 部署、Secret、商户、AI 模型、支付开关或插件安装。
- 没有数据库迁移和新 Secret 前置条件。需用户确认集成候选并单独授权下一阶段发布；不需要再次提供密钥。
