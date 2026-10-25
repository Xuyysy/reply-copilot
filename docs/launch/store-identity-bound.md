# Chrome Web Store 身份已固定（2026-10-23）

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

## 登录与来源校验

网站登录仍只允许各自WEB_ORIGIN；扩展设备码申请/轮询要求精确EXTENSION_ORIGIN，随后由对应网站登录用户批准绑定。Production仅允许商店ID；Staging仅允许原测试ID；不增加通配、缺省Origin或跨环境例外。

本地测试使用实际security.ts、http.ts、device.ts验证：商店origin通过来源门；Staging/伪造后缀/网站origin/null不能请求Production设备码；网站登录不接受扩展origin；CORS预检正常origin204、跨环境403，响应不向错误来源发放CORS头。测试不申请真实设备码、不访问远端，不冒充Production实测。

## Current release status

The stable item ID and key remain fixed; the listing is still a draft and has
not been submitted or published. Production purchase/admin gates remain closed.
Use the current readiness document for the remaining credentials, legal
approvals, Production acceptance, and publication sequence. Do not use this
historical file as a deployment checklist.
