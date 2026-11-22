# 互关助手 / Follow Manager — 官方归档免费版（候选 V1）

范围：独立 Chrome MV3 本地归档分析。相关产品需求 [Issue #243](https://github.com/Xuyysy/reply-copilot/issues/243)。

## 如何使用

1. 用户自行访问 X 设置 → 你的账户 → 下载个人数据归档，完成身份验证后等待 X 生成 ZIP（可能需要数天）。
2. 下载并解压 ZIP。只选择 data/follower.js 与 data/following.js；存在多个分片时，在各自文件选择框中选中所有 part 文件，从 part0 开始。
3. 通过插件侧边栏“互关助手”打开新的扩展内部页面，填写所属 X 用户名（仅用于本机数据分组，不验证登录身份），确认两份文件来自同一份归档后导入。
4. 查看“互相关注”“没回关我”“我没回关”列表。结果按归档中的数字账号 ID 展示，点击“打开 X 主页”可在 X 查询最新状态。导入时间不是 X 归档内容快照的确切生成时间；更改关注关系后必须重新请求/导入归档。
5. 支持搜索数字 ID、每页 50 条、导出当前筛选列表 CSV、本地快照重新加载和删除。不同 X 用户名以 IndexedDB owner key 分开存储。清除 Chrome 扩展数据也会清除快照。

## 安全与隐私

- 不上传整个 ZIP、私信、邮箱、Cookie、访问令牌或名单。只读取用户选择的本地 .js 文件；解析静态 window.YTD.follower/following.partN 的 JSON 数组，绝不执行 .js。
- 不调用 X API、不依赖 x.com DOM、不会调用 Cloudflare Worker、不会增加 Chrome cookies/scripting/tabs 权限；没有自动关注/取关。只有用户主动点击资料链接时才会打开 X。
- 严格校验 1–20 位数字账号 ID，保留 snowflake 字符串精度；默认每个归档文件最多 32 MB，总名单最多 25 万 ID。拒绝非连续或重复分片。无法证明来自同一账号，因此通过用户手工确认归属，不要把名称输入当作官方身份验证。
- 用户文件内容只有数字 ID；没有 X API enrichment，因此不显示姓名、头像、近期取关、关注时长、总实时数据或按用户名搜索。仅能保证所选文件里包含的快照关系，不能保证用户已选齐所有隐藏分片。
- 所有文件在扩展内部页面中处理，使用 IndexedDB 最小化持久化两个 ID 数组，不放进 chrome.storage.local 或账户后端。

## 集成与发布边界

- 在 sidepanel/sidepanel.html 新增一个入口，现有账号、互动势能、AI 回复悬浮框和服务端扣费不变。
- scripts/build.js 将 follow-manager 目录打包进 development、staging、production 构建；不改 manifest 或既有扩展 ID。
- 自动测试：纯函数归档解析、分片完整性、字符串 ID 精度、交并差、输入拒绝、扩展构建和权限隔离、静态 UI 连通性。浏览器内真实导入、IndexedDB 删除/回读、无网络访问与 Chrome Web Store 审核仍需后续人工验收。
- 不发布 Production/Staging Worker 或 Pages，不执行远端 D1 SQL；不自动上架 Chrome Web Store。候选开发分支需独立 CI 通过、获得真人体验反馈后再决定发版。
