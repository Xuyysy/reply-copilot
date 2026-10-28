# Staging 无 debugger 自动填入实验

本实验仅在 `codex/staging-no-debugger` 分支维护，不属于 Production 0.3.1 或其商店审核。

## 现有证据

真实 X 点击触发后，原帖可提取并匹配，随后编辑器关联超时。浏览器中确认回复弹窗的原帖副本包含正文，但没有状态链接；两个嵌套 dialog 共享同一个编辑器节点。当前逻辑依赖状态链接，未进入页面内 AI 生成或输入。正文相同不能单独证明身份。真实 X 的无 debugger 填入、编辑和撤销尚未验收。

## 安全边界

只使用 Staging，保留原扩展加载路径与身份；不自动发布，不覆盖用户草稿。对关联不确定、多编辑器、旧弹窗、切帖和过期操作失败关闭；日志不记录帖子、凭证或个人信息。禁止将实验直接合入正式分支或修改 Production。

## 待完成

先以无 AI 请求的方式验证可信点击到唯一编辑器的关联，包括节点卸载、嵌套弹窗、重复正文、旧弹窗和快速切换；仅在安全关联可靠后验证真实生成、编辑器状态、撤销、发送按钮及单次额度消耗。

## 回滚

原 Staging 备份与恢复脚本位于本机原项目的 `dist` 目录；运行 `restore-staging-stable-20261027-204918-82754.command` 后在 Chrome 扩展页重新加载 Staging 扩展，并刷新 X。不要卸载扩展或清空存储。

## 2026-10-28：新的关联机制

实现见 `experiments/staging-no-debugger/content/composer-association.js` 和实验内容脚本。

- 在可信 pointerdown / 键盘激活时捕获原帖 ID、不可变内容快照、操作时间及点击前所有编辑器节点；click 捕获阶段再次验证同一按钮和原帖。
- 点击前已有可见模态框则拒绝。随后只允许一个新回复编辑器，并要求焦点进入该节点；嵌套 dialog 按编辑器对象去重。
- 弹窗可以没有状态链接；若存在，必须匹配。正文一致只作辅助核对，还必须满足可信激活、基线差分、焦点与未打断的生命周期条件。
- 原帖节点可以卸载；原节点被复用成另一条帖子则拒绝。绑定后关闭、移除、替换节点、竞争操作或非预期导航都会撤销关联。
- 获取阶段最多9秒，操作有效期最多60秒；获取超时或竞争激活后要求刷新 X，防止迟到弹窗被下一次点击接管。
- 关联完成前出现可信 beforeinput 则停止，即使随后文本被清空；绑定后保留原有用户输入保护及一次请求只尝试一次插入规则。
- 默认构建为 `association_only`，不调用 AI、不插入文字。阶段与原因日志不包含帖子、回复、URL、身份或凭证。

### 已取得的真实 X 证据

原有匹配阻断已跨过。两条不同的真实 X 多行帖子记录了 `association_bound`（`new_focused_reply_editor`）和 `association_only_ready`，截图确认浮窗出现；未进行生成或发布。

第一轮新验证发现空白 Draft.js 编辑器实际为 `innerText` 单个换行、`textContent` 为空、一个 BR。旧的空白判断误报 `existing_draft`。仅在实验适配器识别这一个结构性空行；空格、多空行、附件与用户文字继续视为草稿。修复后取得上述真实匹配证据。

截图中没有本扩展的 debugger 调试横幅。真实 X 的 AI 生成、自动输入、内部编辑状态、撤销与扣次仍待一次受控生成验收。原帖卸载、多编辑器、同文案竞争、快速操作和错误导航等边界主要由自动化测试覆盖，不宣称全部已在真实 X 实测。

### 构建及安装

在实验工作树执行：

```sh
REPLY_COPILOT_STAGING_NO_DEBUGGER=1 \
REPLY_COPILOT_API_URL=https://api-staging.x-reply-helper.top \
REPLY_COPILOT_WEBSITE_URL=https://staging.x-reply-helper.top \
node scripts/build.js staging
```

只有获准进行一次真实输入验收时，构建才额外设置 `REPLY_COPILOT_STAGING_INPUT_VALIDATION=1`。不要把输入验收包和仅关联包混淆。

实际加载路径仍为 `/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging`，原扩展 ID `kaaehkpihjenlhjjfjcopkjhegmfmchk` 不变。当前磁盘和浏览器安装的是仅关联包；不卸载、不清除 storage。其他正式扩展在本次验证前已处于停用状态，未更改其开关。

安装前完整备份：`dist/staging-backup-association-20261028-091230`（前一版实验文件）。原 debugger 稳定版另保存在 `dist/staging-stable-backup-20261027-204918-82754`。

恢复稳定版：

```sh
zsh '/Users/xuyaoyang/x posst/apps/reply-copilot/dist/restore-staging-stable-20261027-204918-82754.command'
```

然后在 `chrome://extensions` 重新加载原 Staging 扩展并刷新 X。恢复脚本已做语法检查，备份 manifest 确认包含原 debugger 权限；本轮未实际执行恢复。

### 当前限制

这仍是 DOM 层的操作关联，不是 X 提供的正式原帖—编辑器 API 保证。X 的页面结构、焦点行为或编辑器生命周期变更可能导致安全拒绝，需要真实 X 持续验证。出现歧义宁可停止。当前不建议推广 Production，也不改动正式商店0.3.1。

本轮最终本地验证：`npm test` 580/580 通过，包含真实隔离 Chrome 的 DOM/编辑/撤销测试；Web 构建通过。真实 X 仅验证了上述无 AI 关联及浮窗，不能把这580项自动化结果等同于真实 AI 自动填入验收。
