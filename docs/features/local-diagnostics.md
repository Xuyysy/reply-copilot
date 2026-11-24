# 悬浮窗故障诊断候选版（2026-11-24）

基线：Production 0.3.9 d0d7135f30cd415cb50b6b877706fa5916270b05。新用户侧栏已连接但个别用户悬浮窗不显示，原因尚未复现。独立 Staging hotfix 候选，不含互关助手。

用户打开出问题的 X 标签页，点击普通文字帖的回复，再展开侧栏「故障诊断」并点击「开始检查」。支持复制固定字段 JSON，由用户主动分享。无自动上传、无新权限、无服务器或数据库改动。仅探测活动标签页顶层 content script，不读帖子正文、用户 ID、邮箱、URL、凭据、原始异常或 DOM。账户状态来自侧栏既有读取结果。网站权限未确认不能等同于拒绝；无响应不能证明是权限问题。标准 data-testid 按钮未找到不证明没有任何可用回复入口。仅记录页面存续期间有限的固定事件码，刷新会清空；不持久化，不提供远程日志。

保持既有安全关联、草稿保护、生成与扣费行为，不尝试自动修复或注入。诊断不能直接解决所有悬浮窗问题。需验证新配置浏览器、未刷新 X、网站权限受限、非 X 标签页、普通文字帖、非标准布局、已有草稿、不同浏览器缩放及悬浮窗关闭设置。CI 通过不代表真实受影响用户已修复。

## 定向授权与自助排错（2026-11-24）

参考 Chrome Web Store MV3 requirements（https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements）与 OpenFeature evaluation context（https://openfeature.dev/specification/sections/evaluation-context/）。不引入 SDK 或远程代码。诊断 UI 默认隐藏。独立 GET /v1/extension/support-features 通过已验证 extension session 的 user_id 查询固定 local_diagnostics 开关；只返回布尔值、过期时间和 schema，无用户 ID、原始诊断或规则表达式。缺表、网络异常、无令牌、无权限、过期均关闭。侧栏打开/重新聚焦时检查（60 秒节流），可见时每 5 分钟刷新；开始检查前重新校验。换账号立即失效并清空报告；过期本地计时关闭；不持久化令牌或授权结果。此开关只用于入口可见性，不是服务端数据访问权限，撤销不能阻止用户检查自己本地扩展代码。

管理员用户详情页新增定向诊断卡片，主动查询，24h/72h/7d 授权、续期和撤销。服务端验证现有唯一管理员 web session、CSRF、密码复验、操作原因和 operationId；使用既有 admin_operations/admin_audit_logs 原子写入。新增 api/sql-proposals/0031_user_support_features.sql，仅新增表与主键，不改现有数据。独立 API 避免每次生成/账户读取新增 D1 查询。中文失败原因与排错建议保留报告固定机器码。需要本地迁移、API/网页/插件联调、双账号与撤销、过期、异常及隐私验收后另行批准 Staging 部署及远端迁移；未授权任何生产部署、D1 访问或操作。旧插件必须先安装包含内置功能的新版，之后才可定向开放。

## Staging 验收修正
授权表为独立待批准 SQL 提案，保留 24 个已批准自动迁移和所有生产支付保护检查。本地 SQLite 测试单独应用本提案，验证两账号隔离、管理员复验/CSRF、到期、撤销、幂等与未迁移时默认关闭。不访问远端 D1。Staging 扩展提供明确标识的仅本机预览按钮，30 分钟后结束，关闭侧栏或切换账号清除；预览报告带 staging_preview 标记，不代表后台真实授权。Production 构建不含 staging 模块，不显示预览入口。完整云端授权联调仍需要单独批准 Staging D1 迁移和 Worker/Pages 部署。
