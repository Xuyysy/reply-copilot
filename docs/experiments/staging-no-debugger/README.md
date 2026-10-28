# Staging 无 debugger 自动填入实验

本实验仅在 `codex/staging-no-debugger` 分支维护，不属于 Production 0.3.1 或其商店审核。

## 2026-10-27 历史证据

真实 X 点击触发后，原帖可提取并匹配，随后编辑器关联超时。浏览器中确认回复弹窗的原帖副本包含正文，但没有状态链接；两个嵌套 dialog 共享同一个编辑器节点。当前逻辑依赖状态链接，未进入页面内 AI 生成或输入。正文相同不能单独证明身份。真实 X 的无 debugger 填入、编辑和撤销尚未验收。

## 安全边界

只使用 Staging，保留原扩展加载路径与身份；不自动发布，不覆盖用户草稿。对关联不确定、多编辑器、旧弹窗、切帖和过期操作失败关闭；日志不记录帖子、凭证或个人信息。禁止将实验直接合入正式分支或修改 Production。

## 当时待完成

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

截图中没有本扩展的 debugger 调试横幅。本节记录关联阶段；后续真实生成及输入结果见下方2026-10-28补充。原帖卸载、多编辑器、同文案竞争、快速操作和错误导航等边界主要由自动化测试覆盖，不宣称全部已在真实 X 实测。

### 构建及安装

在实验工作树执行：

```sh
REPLY_COPILOT_STAGING_NO_DEBUGGER=1 \
REPLY_COPILOT_API_URL=https://api-staging.x-reply-helper.top \
REPLY_COPILOT_WEBSITE_URL=https://staging.x-reply-helper.top \
node scripts/build.js staging
```

用户已授权本轮继续进行 Staging AI 验证；构建输入验收包时额外设置 `REPLY_COPILOT_STAGING_INPUT_VALIDATION=1`。不要把输入验收包和仅关联包混淆。

实际加载路径仍为 `/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging`，原扩展 ID `kaaehkpihjenlhjjfjcopkjhegmfmchk` 不变。当前磁盘和浏览器安装的是输入验收包（标准 paste 方案）；不卸载、不清除 storage。其他正式扩展在本次验证前已处于停用状态，未更改其开关。

安装前完整备份：`dist/staging-backup-association-20261028-091230`（前一版实验文件）。原 debugger 稳定版另保存在 `dist/staging-stable-backup-20261027-204918-82754`。

恢复稳定版：

```sh
zsh '/Users/xuyaoyang/x posst/apps/reply-copilot/dist/restore-staging-stable-20261027-204918-82754.command'
```

然后在 `chrome://extensions` 重新加载原 Staging 扩展并刷新 X。恢复脚本已做语法检查，备份 manifest 确认包含原 debugger 权限；本轮未实际执行恢复。

### 当前限制

这仍是 DOM 层的操作关联，不是 X 提供的正式原帖—编辑器 API 保证。X 的页面结构、焦点行为或编辑器生命周期变更可能导致安全拒绝，需要真实 X 持续验证。出现歧义宁可停止。当前不建议推广 Production，也不改动正式商店0.3.1。

关联阶段本地验证为580/580；最新验证与真实 X 结果如下。


## 2026-10-28：真实 X 自动生成与无 debugger 填入已取得成功样本

### 输入方案的证据和选择

1. 原 `execCommand(insertText)` 在真实 X 生成后的试验中出现文字重复；撤销后 DOM 残留与 Reply 按钮状态不同步。该路径不再用于实验包。
2. 采用标准 `DataTransfer(text/plain)` + `ClipboardEvent(paste)`，交给 X 的公开粘贴处理器。事件仍为 `isTrusted=false`，不伪造可信属性、不访问 React 私有对象、不直接赋值编辑器文本、不访问系统剪贴板、不调用 debugger。
3. 合成 paste 没有浏览器默认插入行为：必须由页面处理并 `preventDefault`，随后现有代码检查实际完整文本一致。拒绝、异常或不一致时不追加另一种输入策略，保留复制兜底。
4. 内容脚本仍检查同一节点、请求 ID、空白草稿、可见性、页面及编辑器焦点、Selection 和当前操作有效性。一请求最多一次尝试。插入前失败只记录布尔事实，日志不含帖子/候选正文、URL 或凭证。

官方参考（解释机制，不能替代真实 X 验收）：

- [MDN paste event](https://developer.mozilla.org/en-US/docs/Web/API/Element/paste_event)：合成事件本身不会改变文档内容。
- [Draft.js paste handler](https://github.com/facebookarchive/draft-js/blob/main/src/component/handlers/edit/editOnPaste.js)：页面编辑器的粘贴路径负责更新编辑状态。
- [Draft.js controlled state](https://draftjs.org/docs/advanced-topics-editorstate-race-conditions/)：编辑器状态同步的约束。
- [Chrome isolated content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)：与页面共享 DOM，JavaScript 环境隔离。

### 真实 X 结果（未发布任何评论）

| 验证 | 实际结果 |
| --- | --- |
| 无 AI 关联 | 两条普通多行帖子的唯一新回复框关联成功，浮窗出现；弹窗无状态链接、嵌套 dialog 去重 |
| 标准粘贴单独试验 | 中英文、Emoji、多行进入真实 X；Reply 可用；追加、撤销追加、撤销整次粘贴正常 |
| 完整自动流程 | 原生 Reply 点击 → association_bound → generation_started → generation_returned → insert_verified；无需复制或额外插入点击 |
| 原生内部状态 | 自动草稿只出现一次，Reply 启用；追加普通文字可编辑；第一次撤销追加，第二次撤销整份 AI 草稿，Reply 随之禁用 |
| 扣次 | 成功样本 UI 额度1318→1317，日志一个生成开始和返回；本轮3次真实生成总计1320→1317（含先前失败试验），无自动重试 |
| debugger | 实验 manifest 无 debugger，产物无调用，真实浏览器无该扩展调试横幅 |

一次中间试验在生成后被 `insert_context_changed` 拦下，未执行输入；当时未记录细分事实，不能断言唯一原因。另有获取阶段 `association_expired` 的安全拒绝。新增可见性/焦点/连接/草稿布尔诊断，不降低校验。保持 Chrome/X 前台后取得上述成功样本。

### 本地验证及状态

- `npm test`：**582/582**，含本地 Chrome DOM/粘贴接受/编辑/撤销、关联竞态和输入保护；全套命令含 Web 构建，通过。
- 成功样本来自真实 Chrome X、Staging 内容脚本与真实 AI；隔离编辑器测试没有被当作真实 X 证据。
- 新输入实现及测试仅在实验覆盖文件与构建开关下生效；Production源文件、商店ZIP、API/D1/支付未改动；正式工作区原有3处隐私修改保留。
- 仍需用户在不同帖子、线程/详情页、语言、长文、不同X编辑器版本中持续验收。快速切帖、旧弹窗、多编辑器、原帖卸载、用户抢先输入主要有自动化覆盖，未宣称每个边界均真实 X 实测。
- 这是可继续人工验收的候选方案，不是达到 Production 等效可靠性的证明；不自动推广或合并正式版本。

当前已加载输入验收包，原路径和 Staging ID 不变。用户可重新加载原扩展并完整刷新 X，点击普通帖子的原生 Reply 体验；测试后关闭空草稿即可，不要按发布按钮。失败请提供浮窗状态或仅以 `[xrh-staging-composer]` 开头的阶段日志。出现 `activation_requires_reload` 应完整刷新 X 后再试，不反复点击同一过期操作。

## 2026-10-28：连续回复与图片帖兼容

用户实际反馈首次成功后提示 `competing_activation` 并要求刷新。原逻辑在下一次可信点击到达时，只要旧操作仍标记为活跃，就会把新操作视为竞争；X 关闭弹窗与 MutationObserver 清理之间存在事件先后差异。现在在新点击时先同步检查已绑定的旧编辑器：已关闭则结束旧会话、取消未完成请求并移除浮窗；多个可见编辑器或真正竞争时仍拒绝。关闭回复框属于正常结束，不显示竞争错误。未绑定时的快速竞争仍保留失败关闭，不能把迟到弹窗交给另一次点击。

一次真实 X 复测中，第一条正常自动生成并填入；不刷新打开第二条后，已进入新的关联，但带图片帖因正文副本追加图片引用而被 `reply_context_unconfirmed` 安全拒绝，没有触发 AI。只读 DOM 检查确认原帖确有其自身 status 的图片链接，副本文本仅额外添加一项 `pic.x.com` 引用。实验适配器仅在可信点击时预先捕获同一 status 的图片证据，且原正文完整一致、额外内容仅为限定格式的图片引用时接受；任意网址、额外文案或其他帖子的图片证据仍拒绝，不将图片链接作为身份依据。

最新自动化验证：`npm test` 587/587 通过；专项覆盖连续三次使用、旧生成迟到、正常关闭、操作过期、真实竞争、图片引用和错误图片来源。最终版本已放入原 Staging 加载路径，manifest 不含 debugger，配置指向 Staging API；最终版本的真实连续回复和图片帖仍需完成浏览器复测，不能根据模拟测试宣称全部真实场景已通过。引用帖、焦点未自动进入编辑框等场景仍可能安全拒绝；关联歧义时不会跨帖填入或覆盖用户内容。原 debugger 稳定备份和本机回滚脚本保持可用。

### 连续会话真实 X 复核（2026-10-28）

以提交 `b8bf5de` 的实验构建进行验证：无 AI 关联模式下，四条不同帖子的回复框依次打开、关闭，均成功关联，未刷新页面。临时只读 DOM 探针显示，四次新点击时前一个编辑器均已断开、不可见，且没有可见的旧编辑器；这是正常关闭路径的观察，不能证明用户最初遇到竞争时的具体 DOM 时序。日志中正常关闭期间出现过 `editor_replaced_or_closed` 安全拒绝，之后的新会话仍能建立。

随后切回完整输入验收构建，在同一 X 页面连续对两条不同帖子执行真实 AI 生成：两次均自动填入原生回复框，Reply 按钮启用；各自执行撤销后编辑框为空且 Reply 禁用。期间没有发布评论，也没有出现本扩展 debugger 横幅。该结果不代表快速关闭动画、多编辑器、节点复用和迟到响应均已在真实 X 验收；这些边界仍需持续测试。另曾观察到一次回复框焦点未及时进入导致关联超时，重试后成功，尚未确定触发原因。

当前 Chrome 加载的是完整 Staging 输入验收包，保留原扩展 ID 和 Staging API，不含 debugger 权限与调用；正式版本和正式工作区未改变。上述结果补充真实浏览器证据，自动化结果仍为此前的 587/587；并非本次重新运行的测试。
