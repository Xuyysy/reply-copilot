# x-Reply-Helper｜发布与更新状态（2026-10-29；更新于 2026-10-30）

## 2026-10-30｜Production AI 多模型管理上线，Qwen 激活并通过用户验收

- **发布与人工验收：** 用户报告 AI 模型管理与成本统计已部署 Production，随后明确确认“可以了没问题”。这属于用户本人对最新 Production 功能的验收反馈；不能推断所有长期运行问题或外部服务账单均已独立审计。
- **GitHub Production 发布：** 功能发布分支 `codex/production-ai-model-management`，提交 [`2d58c42e7e6d44382699c29809c4c586afe5fba5`](https://github.com/Xuyysy/reply-copilot/commit/2d58c42e7e6d44382699c29809c4c586afe5fba5)。兼容旧插件的 API 层规范化输出省略可选 `score:null`，兼容旧结果重放；用户转述 Codex 测试 **675/675 通过**，并声明旧 0.3.1 ZIP 解析器通过回归。本次记录不等于重新独立执行测试。
- **Production Cloudflare 独立只读核验：** Worker `reply-copilot-api-production` 当前 deployment `d58118cc-a49e-45db-8041-3394ef49f5a7`，version `911038c0-36a9-4062-96b9-38de2b26ef55` 100% 流量；D1 `d9df7d23-9b9c-44ac-a33a-c24474c15691` 已记录 `0018_ai_provider_management.sql`。Worker Secrets 绑定包含 `AI_CONFIG_ENCRYPTION_KEY` 和 `DEEPSEEK_API_KEY`（仅核实存在，不读取值）。`AI_MODE=production`、`ADMIN_PORTAL_ENABLED=1`、`PAYMENTS_ENABLED=1`、D1 `active_merchant=mk99` / `purchase_enabled=1`。
- **当前正式模型状态（后续已变更）：** 初次 Production 部署时激活指针为空，保持 Legacy DeepSeek / `deepseek-flash`。**用户验收后，本次只读查询证实当前指针已切换到已保存的 Qwen v1（`provider=qwen`, `model_id=qwen3.7-flash`），不再将 Legacy DeepSeek 写作当前模型。** Secret 值和具体密文未读取。未在此轮主动触发真实 AI 请求。
- **Production Pages：** 用户转述部署 ID `f42e556d-975a-4049-8aa1-6b32ad42cfc0`，本次同步未独立复核 Pages 元数据、终端浏览器显示或精确资产哈希。
- **商店版本独立记录：** 用户同日确认 Chrome Web Store 正式版为 **0.3.2**，原商店 ID `fgfjajofkapebgphfidblngcjomkbdaj`。Codex 的“旧 0.3.1 兼容”是对历史已发布客户端的向后兼容保障，不应误写为“商店当前仍是 0.3.1”。
- **边界与回退：** DeepSeek 旧服务 Secret 仍在，配置设计允许回退；是否能随时无故障回滚还取决于实际权限和生产运行状态。继续观察模型输出质量、生成与 ACK 幂等、额度只扣一次、历史成本、支付链路以及隐私政策披露；不把本次用户验收等同于全面安全/合规审计。GitHub 状态文档更新不会修改生产 Worker/Pages、D1、模型激活配置或 Chrome 商店包。
  
---

> **最新商店状态（2026-10-30，用户亲自确认）：Chrome Web Store 的 x-Reply-Helper 已从已发布的 0.3.1 更新至正式版 0.3.2。** 此前文档中“0.3.2 待审核/尚未发布/暂不上传”均属于 **2026-10-29 的历史阶段记录**，不是今天的最新状态。

## 2026-10-30｜Chrome Web Store 0.3.2 正式发布确认

- **发布确认来源：** 用户于 2026-10-30 在当前对话明确表示“我的谷歌商场插件现在已经更新到0.3.2的版本了”。据此将 **0.3.2** 标记为 **Chrome Web Store 当前正式版本**，0.3.1 归档为前一正式版本。实际审核时间、上架 ZIP 的字节校验、当前商店页面权限列表没有在本次文档同步中独立读取，不能编造。
- **原商店条目：** x-Reply-Helper，扩展 ID `fgfjajofkapebgphfidblngcjomkbdaj`；商店地址：https://chromewebstore.google.com/detail/fgfjajofkapebgphfidblngcjomkbdaj 。继续使用原条目，不另建扩展。
- **版本背景：** 此前 0.3.2 的开发和用户人工测试目标是移除 `chrome.debugger`、采用原生回复框兼容填入；Staging 使用 0.3.2 并经用户实际测试成功。上述技术背景不等同于本轮对 Chrome 商店分发包独立验证；若要对外宣称移除全部权限警告，需以已发布安装包的 `manifest.json` 为准。
- **环境边界：** Chrome Web Store 0.3.2 已发布，**不代表** Staging 的 AI Models 管理、Qwen 激活、成本统计等功能已进入 Production；Production 后端/网站的实际部署状态必须单独核验。此更新**没有**部署 Worker/Pages、执行 D1 SQL、修改生产 AI 模型或支付设置。
- **持续关注：** 旧客户端兼容、AI 回复 JSON、交付确认 ACK、额度只扣一次、特殊帖识别和正式隐私政策/商店 Data usage 的一致性。历史排障和候选分支记录仍保留，不误写为全部问题已彻底解决。

---

> 状态记录，不是发布批准书。区分用户亲自验收、GitHub 已推送源码、Cloudflare 已部署服务与 Chrome Web Store 已发布条目；各项不互相证明。本文只记录截至 2026-10-29 的已知情况。

## Chrome Web Store

- **0.3.1：用户确认已经正式发布。** 原商店条目 ID 为 `fgfjajofkapebgphfidblngcjomkbdaj`；仍采用 `debugger` 原生输入路径。商店链接：https://chromewebstore.google.com/detail/fgfjajofkapebgphfidblngcjomkbdaj
- **0.3.2：无 debugger 候选，用户已在真实 Chrome/X 中试用，近期反馈没有问题。** 截至本记录，用户正在处理商店 Privacy 表单；没有用户确认“0.3.2 ZIP 已上传/通过审核/对公众发布”，故不可标为已发布。
- 用户测试截图显示生产扩展 **0.3.2** 且扩展 ID 与原商店条目相同；源码 `manifest.json` 在 `codex/production-0.3.2` 上声明 `contextMenus`、`storage`、`sidePanel`、`clipboardWrite`，不含 `debugger`。**源码里的开发 host permission 不等于最终 ZIP 的 host permission**，正式打包仍须检查 ZIP 内实际 `manifest.json`、正式 API 配置及 ZIP/本地测试包一致性。
- 0.3.1 正式版继续可用；没有用户指示下架、取消公开或自动更新商店包。

## 源码与环境证据

- 仓库：`Xuyysy/reply-copilot`；无 debugger 候选分支 `codex/production-0.3.2`。截至读取时 HEAD [`c0e0f104`](https://github.com/Xuyysy/reply-copilot/commit/c0e0f104b236d2f1dfca66e269bfd568025d5781)，包含：
  - [`7b118d08`](https://github.com/Xuyysy/reply-copilot/commit/7b118d082832b228cbd66ce08ebe4a44da8f6916)：0.3.2 无 debugger 生产插件候选。
  - [`ea3bc7aa`](https://github.com/Xuyysy/reply-copilot/commit/ea3bc7aa559c5a3ae9b9d8a6641f98c5a0abe49a)：调整服务端 reserved 请求并发保护，使有可重放结果的 `awaiting_delivery` 请求不会单独阻挡后续生成；附隔离回归。**代码已推送不代表已部署、真实故障已彻底修复或旧请求 ACK 已恢复**。
  - [`c0e0f104`](https://github.com/Xuyysy/reply-copilot/commit/c0e0f104b236d2f1dfca66e269bfd568025d5781)：双语服务条款与客服联系方式源码。
- 正式 [PR #2](https://github.com/Xuyysy/reply-copilot/pull/2) 仍处于 Draft，HEAD `b9ae600`；未把候选分支变更视为已合并正式 PR。
- Production Worker 曾经据独立核验部署 `e0fa8099`（2026-10-29），包括较早的 `b0fb9948` 超时生成预占收尾。这里**没有**核实 `ea3bc7aa` 已进入线上 Worker。
- 用户此前实际见过“上一条回复仍在等待交付确认”错误；Production D1 只读曾发现一笔 `reserved/awaiting_delivery/consumed=0/raw_response 存在` 的请求，后续用户重试表示当前体验正常。属于需要继续观察的偶发交付一致性问题；不能仅凭近期可用宣称根治。
- Staging 无 debugger 独立实验分支 `codex/staging-no-debugger` 保留，部分未被人工验证的特定帖子识别修复不要无差别合入。

## Chrome Web Store Privacy（0.3.2）

- 目前表单的权限解释包括 `contextMenus`、`storage`、`sidePanel`、`clipboardWrite` 和正式 API/X 页面 host permission。**不含 debugger justification 是移除权限后的正常现象，无需寻找隐藏字段删除。**
- Single purpose 保留“从选定 X 帖子生成三条可编辑回复候选、可插入原生编辑框、最终由用户亲自发布”；不应宣称自动发布。
- Remote code：现有受审核代码由扩展内本地 JS 执行，云端只返回 AI 文本/数据，申报应按实际实现填写，而非把云端 AI 误写成远程运行代码。
- Data usage 需真实披露账号邮箱/标识、认证令牌、选定帖子文字与 URL、写作样本/回复历史和用户使用动作；是否涉及独立支付数据、位置/IP 或其他分类，仍需按实际收集与传输链路复核。第三方 DeepSeek 处理及保留期限须与隐私政策一致。
- **待办：** `web/src/pages/privacy.astro` 仍含 `Draft privacy policy`、上线前审核提示和账户删除渠道待确认；`privacy.html` 仍含“尚未通过 Chrome Web Store 审核”。确认线上实际页面后，完成正式隐私政策、联系方式、数据请求途径和对应包文案更新。仅更改源码不代表网站已部署。
- 隐私政策地址：https://app.x-reply-helper.top/privacy/ （用户提交的表单地址）。

## 发版前最小核对

1. 核对待上传 ZIP 的真实 `manifest.json`、版本 `0.3.2`、原插件 ID、无 `debugger`、正式 API/官网和用户实测包一致。
2. 更新/核对公开隐私政策和商店 Data usage；不要把文档建议当作未确认的事实或法律审核结论。
3. 新 ZIP 上传同一商店条目，检查权限和审核页面后由用户本人提交；不得把“准备审核”写为“已经发布”。
4. 持续观察交付确认异常、额度预占和特殊帖子关联。保证不串帖、不自动发送、不重复扣费。Production 变更单独验收、可回滚。

## 关联记录

- Notion 项目总控：https://app.notion.com/p/402c089052a381869bf0d82015011e10
- Notion Staging 实验：https://app.notion.com/p/406c089052a3811b890ffe8cebac95f0
- Github 生产候选：https://github.com/Xuyysy/reply-copilot/tree/codex/production-0.3.2

本次同步仅更新项目文档，不修改插件业务逻辑、部署、财务记录或商店发布设置。
