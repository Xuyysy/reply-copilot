> **当前商店正式版本（2026-10-30，用户确认）：** x-Reply-Helper 已在原 Chrome Web Store 条目 **正式更新至 0.3.2**（原扩展 ID `fgfjajofkapebgphfidblngcjomkbdaj`）。0.3.1 为此前正式发布的历史版本，0.3.2 不再是“待提交/待审核”的商店候选。此前测试的 0.3.2 方向为移除 `debugger`；最终商店安装包在本次文档同步中未独立下载校验。**Chrome 商店版本更新不等于 Production Worker/Pages 或多模型管理功能已部署。** 下方 0.2.0-beta 内容仅为历史开发说明，不能作为现行产品现状。详见 [10 月 29 日发布记录及 10 月 30 日更新](docs/launch/release-status-2026-10-29.md)。

---

# Reply Copilot 0.2.0-beta — 商业化客户端适配版

这是 Chrome Manifest V3 扩展的客户端版本。当前源码与开发构建保留本地开发模式，可继续用已有 DeepSeek API Key 生成回复。官网、登录、云端试用、支付和终身许可证服务均未上线；界面中的开发模拟状态不代表实际授权或额度。

## 本地使用

1. 在本目录执行 `npm run build:dev`。
2. 打开 Chrome 的 `chrome://extensions`，开启开发者模式，选择“加载已解压的扩展程序”，指向本仓库的 `dist/development`。
3. 欢迎页选择“本地开发测试：使用自己的 Key”，继续原有风格设置并保存 DeepSeek Key。已经保存的 Key、Voice Profile、历史和悬浮窗位置会保留。
4. 重新加载扩展后，刷新已打开的 X 标签页。点击帖子的原生回复按钮，检查候选回复和输入框中的草稿。扩展不会点击发送。

如果当前 Chrome 已将源码目录加载为解压扩展，也可继续从该目录重载，保留同一扩展 ID 和本地数据。切换加载目录通常会得到新的扩展 ID，旧扩展的本地存储不会自动转移。

`npm run build:production` 只构建正式客户端骨架，**不含开发状态模拟模块，也没有可用的官网或云端服务地址**。在真实官网、授权后端和回调流程接入前，不应将其作为可付费产品发布。生产版当前未开放登录和生成。

## 架构与边界

- `ReplyEngine` 和唯一的 `PromptBuilder` 保持原样。后台及备用侧栏将原始生成调用接到 `AIProviderRouter`。
- 开发构建默认 `developer_mode`，调用原有 `DeepSeekClient` 和用户自己的 Key。生产构建只接受未来可信服务端返回的 `trial_active` 或 `lifetime_active` 状态。试用走 `HostedAIClient`，终身授权走 BYOK。云端未配置时明确报错，不伪造真实额度。
- 账户状态统一由 `AccountStateService` 读取并短时缓存；同时读取会复用一次请求。开发模拟入口仅在开发构建的“账户与授权”设置页，切换状态不会改动真实授权。
- 用户 Key 只在可信扩展上下文读取；X 的 content script 不读取 Key。现有 `chrome.debugger` + `Input.insertText` 自动填入及手动复制路径未重写。Chrome 调试权限提示仍可能显示。
- 新增 `replyCopilotStorageSchemaVersion=2` 的幂等迁移标记，不清空既有 Key、风格、样本、历史、统计或位置。
- 未来 Cloudflare API 的字段、错误码和幂等规则见 [接口契约](docs/cloudflare-api-contract.md)。接入真实服务时需要 HTTPS 官网、Worker 地址、精确 host permission 与安全的扩展登录回调。

## 验证

在本目录运行 `npm test`，以及 `npm run build:dev`、`npm run build:production`。自动化测试不调用真实 DeepSeek，不产生模型费用。真实 X 回复框的自动填入效果需要在 Chrome 手动检查：生成后确认文字仅出现一次，能编辑删除，切换风格、再生成和复制可用。更新扩展后须刷新 X 标签页。不要将开发模拟的“试用中”当作真实计费结果。

## 隐私

本地开发模式向 DeepSeek 发送当前帖文、Voice Profile、写作样本与最近选择的回复，以生成草稿。Key、个人设置、历史和本地统计保存在扩展本地存储。正式云端模式只定义了接口，尚无数据发送到 Reply Copilot 后端。见 [隐私说明](PRIVACY.md)。
