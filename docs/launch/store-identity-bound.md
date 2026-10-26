# Chrome Web Store 身份已固定（2026-10-23）

## Production 发布记录（2026-10-25）

- Production Worker `1372df1f-f290-44cd-957f-b8f3506a4643` 已承接 100% 流量；Pages `18d8cca1-fc54-47f8-a73f-d1ed49a43242` 已部署到 `https://app.x-reply-helper.top`。
- 正式扩展候选 ZIP：`dist/release/reply-copilot-production-0.3.0.zip`，SHA-256：`efe98c8aa5e55de71d34ed42305a40121872cd8eca0fd095f3ab5c3a7135c574`。包检查确认固定现有 Item ID 和 Production API/Web Origin，无 Staging Origin、测试密钥或服务端凭证。
- 本 ZIP 尚未上传到开发者后台，也未提交审核。必须继续使用既有 Item ID `fgfjajofkapebgphfidblngcjomkbdaj`，不得新建商店条目。
- 上线阻断仍包括：Production 普通账号注册与真实 X 页面实测、账号验证和 200 免费额度、唯一管理员初始化、MK99 Production 渠道路由及正式支付验收，以及经营者对隐私/条款/退款与客服披露的最终确认。

> 本文件只作为扩展身份记录。其旧 Production 资源、迁移和待办状态已过期；
> 当前 Production 上线状态以
> [production-readiness-2026-10-25.md](production-readiness-2026-10-25.md) 为准。

- 商店现有Item ID：`fgfjajofkapebgphfidblngcjomkbdaj`。
- 用户提供的RSA SPKI公开公钥已推导校验，与该ID完全一致。没有生成新密钥或新商店条目。
- 公开元数据：`config/extension-store-identity.json`。Production构建默认使用它，不再依赖临时Shell变量；任何试图覆盖成不同ID/公钥的Production构建均拒绝。
- `scripts/store-release.mjs --production`生成 `dist/release/reply-copilot-production-0.3.0.zip` 和 `production-package-audit.json`。包为正式身份候选，仍需正式后端部署后才可公开；没有自动上传/提交审核/发布。
- Production 插件身份配置为连接 `https://app.x-reply-helper.top` 和
  `https://api.x-reply-helper.top`，不连接 Staging。Production Worker、Pages
  和 D1 已存在，D1 UUID 已配置并完成 0001–0017 迁移；但线上版本早于
  最新审查提交。不要按本文件的旧资源待办重建环境。
- Staging源码manifest不写商店key，继续当前路径加载的独立ID `kaaehkpihjenlhjjfjcopkjhegmfmchk`，Staging Worker扩展来源不变。商店ID插件不应借用Staging授权Token、登录会话或余额。

## 既有商店草稿上传记录（跨聊天同步：2026-10-25）

- 用户明确确认曾在 Chrome Web Store **上传过一次插件**，并已存在商店条目；**不要重新创建条目或申请新扩展 ID**。既有 Item ID 为 `fgfjajofkapebgphfidblngcjomkbdaj`。
- 2026-10-22 的早期聊天记录提及首次商店草稿包 `reply-copilot-store-DRAFT-0.3.0.zip`，当时要求将条目保存为草稿，**不要**点击 Submit for Review / Publish。该记录只能证明当时准备的草稿包与操作目标；无法独立核实实际首次上传成功的精确时间、字节哈希及后台上传版本。
- **状态区分：**“用户曾手动上传插件至商店草稿条目”与“尚未提交商店审核/尚未发布”并不冲突。下文所说的“没有自动上传”仅表示 `scripts/store-release.mjs` 不会上传商店，不是说用户从未手动上传。
- 目前记录可确认为：已有条目及固定身份、条目仍按 **Draft / 未提交审核 / 未公开发布** 管理。真正审核/上架状态需以 Chrome Web Store 开发者后台为准；GitHub 和 Notion 不能代替商店后台。
- 新的 Production 候选包 `reply-copilot-production-0.3.0.zip` 不等同于早期草稿包。后续在**同一**商店条目更新经正式环境验收的新版 ZIP、截图、权限解释和隐私资料，仅在用户批准后提交审核。不重新建商店条目，不把 Staging 插件 ID 与正式 ID 混用。

## 登录与来源校验

网站登录仍只允许各自WEB_ORIGIN；扩展设备码申请/轮询要求精确EXTENSION_ORIGIN，随后由对应网站登录用户批准绑定。Production仅允许商店ID；Staging仅允许原测试ID；不增加通配、缺省Origin或跨环境例外。

本地测试使用实际security.ts、http.ts、device.ts验证：商店origin通过来源门；Staging/伪造后缀/网站origin/null不能请求Production设备码；网站登录不接受扩展origin；CORS预检正常origin204、跨环境403，响应不向错误来源发放CORS头。测试不申请真实设备码、不访问远端，不冒充Production实测。

## Current release status

The stable item ID and key remain fixed; the listing is still a draft and has
not been submitted or published. Production purchase/admin gates remain closed.
Use the current readiness document for the remaining credentials, legal
approvals, Production acceptance, and publication sequence. Do not use this
historical file as a deployment checklist.
