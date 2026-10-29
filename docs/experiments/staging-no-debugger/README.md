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

## 2026-10-29：特定帖子未触发的提取与点击路径候选修复

用户报告可连续处理多帖，但偶发某条帖子不出现浮窗；切换到另一条通常恢复。尚无该次失败的诊断报告，根因**未确认**，也没有执行真实 X 或 Computer Use。

源码审查确认两个可复现的脆弱条件（这是代码证据，不是该现场的因果证明）：

- 旧 Staging 包复用通用提取器，只识别普通 `/<user>/status/<id>` 链接和 `[data-testid="tweetText"]`。嵌套引用内容会被排除（正确），但 `/i/web/status/<id>` 和明确的长文正文节点没有专属处理；任何缺链接或缺 `tweetText` 都合并为一个 `post-context-incomplete`，无法区分身份缺失和纯媒体无正文。
- click 必须与 pointerdown 命中同一个 Reply DOM 节点。若 X 在两个事件之间替换按钮，点击会进入 `activation_not_captured`；这是一个可能的偶发拒绝路径，但没有现场日志证明该帖子触发了它。

实验候选增加 Staging 专用 `post-extractor.js` 覆盖，不修改通用/Production 提取器。它识别普通与 `/i/web/status/` 的 HTTPS 状态链接，严格限定状态路径和数字 ID；只提取被点击的外层 article 自己的正文，优先 tweetText，缺少时才读取已知 `longformRichText`。无法确认身份返回 `status_id_unavailable`，纯媒体且无正文返回 `post_text_unavailable`。帖子类型诊断仅使用枚举：text/photo/video/poll/quote/longform；不记录正文、链接或作者。

可信点击处理增加两种有边界的恢复：同一 article 对象在 pointerdown/click 之间替换 Reply 控件时，click 阶段重新提取并要求 status ID 与正文快照完全一致；若 pointerdown 缺失/过期，则只从可信 click 的当前 article 重新提取，且要求页面没有既存回复 dialog/editor。相同正文的不同 status 若弹窗缺少 status link，会与最近最多 8 个已点击帖子比较并按歧义拒绝；不以正文相似度绑定。实际状态链接若指向不同 status、多个编辑器、已有草稿、未获焦点或来源变化，仍然失败关闭。最近帖子快照只保存在当前 content-script 内存中，诊断报告不包含它们。

诊断报告 build 改为 `staging-post-context-20261029-1`，增加脱敏 `pathCounts`，覆盖 `source_unverified`（并区分 extractor 子原因及节点计数）、`activation_not_captured`、`source_changed`、`reply_context_unconfirmed`、`awaiting_editor_focus`、`association_expired` 及 click 恢复/拒绝。报告只包含 enum、计数、布尔值和相对时间，不包含帖子内容、回复、URL、请求 ID或账号信息。等待编辑器焦点/上下文时按状态变化记录一次，不由 MutationObserver 反复刷日志。

自动化新增了 post-extractor 变体、外层/引用帖隔离、普通和 `/i/web/status/` 身份、纯媒体拒绝、可信 click 恢复、同文章按钮替换、同正文不同 status 歧义拒绝及失败路径计数测试。此候选尚未通过用户的真实 X 特定帖子验收；不同 X 页面结构与 X 后续 DOM 变更仍有风险。请用户在真人验收前仅安装 Staging 构建并刷新 X；不要将自动化通过写成现场问题已解决。

## 2026-10-28：连续回复生命周期修正

用户反馈按实际使用顺序仍可稳定复现第二条 `competing_activation`，此前自动化和有限的真实 X 样本不足以证明问题解决。安装目录中关键文件与实验构建的哈希一致，不能仅凭文件一致性证明当时页面已重新加载了对应内容脚本。

已确认一个具体生命周期缺陷：用户重新生成后 `requestId` 变化，原编辑器会话的观察器和同步检查仍与旧请求 ID 绑定，不能清理旧会话；关闭后新点击可能被判为竞争。会话观察器现在绑定稳定的会话对象，请求 ID 仍独立用于防止迟到结果写入。先增加会失败的回归测试，再修复并通过；连续会话测试扩展至五次，原有真竞争、关闭、隐藏模拟、迟到结果和草稿保护仍保留。完整测试 588/588 通过。

尚未证实这就是用户不重新生成时每次复现的唯一原因；不同的关闭动画或编辑器状态仍可能导致安全拒绝。必须由用户在真实 X 按原操作复验，不能将自动化通过当作最终验收。若仍失败，保留脱敏阶段日志，不记录帖子或回复正文。

## 连续回复候选：区分弹窗内按钮（2026-10-28）

用户明确报告 `780681b` 在真实 X 上第二条仍稳定失败；此前少量成功样本不是验收通过的证据。审查发现回复按钮检测器按可见文本和 aria-label 匹配，可能把原生回复弹窗内的 Reply/Replying to 按钮当作新帖回复操作，引发 `competing_activation` 并永久设置阻断标记。新回归测试在修复前复现这一错误；候选仅排除原生 dialog 内的控件，仍保留真正的新帖竞争检查。这是经代码和模拟测试证明的缺陷，但未经用户现场日志确认，不能断言其是用户实际失败的唯一根因。

新增无 AI 十次连续关联测试及脱敏 `activation_state` 日志，记录活动会话、取消状态、编辑器连接和可见数量以及竞争标记，不记录帖子或回复内容。`content_ready` 中的 `session-controls-20261028` 可辨别候选内容脚本。完整测试 590/590 通过；用户真实连续操作尚未复验。未绑定会话及竞争不确定时仍会保守要求刷新，安全恢复尚未完成；旧编辑器节点被 X 复用的真实情况也尚未证明可安全自动恢复。候选不得视为完整解决或推广到 Production。

## 2026-10-28：隐藏内部会话状态提示

实验浮窗此前会把 `rejectAssociation()` 的内部 reason 原样拼进“关联已停止”状态，即使生成和填入已成功，编辑器随后关闭/替换也可能覆盖成功提示。现在 reason 继续进入脱敏诊断日志；生命周期错误映射到友好操作提示，已成功填入（`appliedText` 已确认）的会话不再显示 teardown 提示。账号、额度、设置和自动填入失败提示保留。

新增成功填入后编辑器替换、以及获取超时的提示回归测试。完整测试 592/592 通过。此改动只调整实验版 UI 状态提示，不改变关联/生成/输入状态机。

## 2026-10-28：页面驻留/超时后的可恢复性候选

本地与 GitHub 已核对的实验基线为 `cec9d3ff4083497509286a8247ec31253c423911`。用户报告 X 页面停留或使用一段时间后，原生 Reply 偶尔不再出现浮窗；间隔、连续次数、标签页前后台与故障阶段尚未通过真实日志确定。

### 已确认的代码缺陷

- 未绑定会话在 `association_expired`、未绑定 `competing_activation` 等拒绝路径将页面级 `activationTainted` 置为 `true`。
- `captureActivation()` 此后会在所有后续帖子 Reply 点击上提前 return。
- 当前源码没有任何代码把 `activationTainted` 清回 `false`；因此一旦该路径发生，同一内容脚本实例会一直静默阻止点击，完整刷新会重置脚本状态。这是确定存在的永久阻断路径，符合“刷新后恢复”现象，但尚不能证明它就是用户每次间歇故障的实际触发原因。后续由用户复制的诊断报告可区分是否出现该路径，当前候选不再保留该永久锁。

### 候选修复与防护

- 将永久 taint 改为 `recoveryRequired`：拒绝仍只终止当前操作；下次可信用户手势会检查可见 dialog/editor。只在页面无可见回复弹窗及编辑器时清理已取消会话、计时器、监听器和浮窗，并接收新的可信回复操作。若旧弹窗/编辑器仍可见，继续阻断，要求先关闭后重试。
- 未绑定操作被拒绝时，在内存中短暂保留最多 8 个旧帖状态 ID 与内容快照，供关联器排除可能迟到的旧弹窗。若新候选没有状态 ID 且内容与隔离项相同，返回 `stale_activation_ambiguous`，不生成/填入；它不会被写入诊断摘要或持久化。
- 原 9 秒获取期限、60 秒单操作期限、焦点/节点/草稿/请求 ID 检查均保留。旧 AI 响应仍以会话对象、requestId 和 cancelled 状态阻止串帖；输入最多尝试一次，不自动发送。
- 增加匿名会话序号、相对时间、内容脚本构建标识、可信手势/Reply 入口计数、定时器、运行时上下文、dialog/editor 计数、会话清理及浮窗挂载/脱离记录。报告通过内容脚本隔离世界的 `__xrhStagingDiagnosticReport()` 复制；只输出状态枚举、布尔值、计数和相对时间，不包含正文、回复、URL、用户/请求 ID、Token 或 Cookie。

### 回归验证及限制

- 新增测试复现未绑定超时后永久拒绝、真实竞争后关闭旧弹窗再操作、页面无操作闲置 30 秒/90 秒/3 分钟/5 分钟、绑定会话后台式时间跨过 60 秒、迟到同文案弹窗隔离和诊断脱敏。
- 修复前上述两种“超时/竞争后页面已空仍拒绝新会话”回归测试失败；修复后专项 DOM/状态机/输入测试通过。
- 这些是虚拟时间/模拟 DOM 测试，不等于真实 X 的 5 分钟、标签页休眠或长驻留验证。偶发故障根因仍需用户现场报告证明；若报告的 `trustedGestureCount` 增长但 `replyControlPointerCount` 不增长，优先检查 X 按钮识别；若 Reply 入口增长但 session/mount 阶段缺失，检查激活/关联；若 `runtimeAlive=false`，则是扩展上下文失效，刷新页面只能重建上下文。

待最终专项与全量测试后构建 Staging 输入验收包，备份原 `dist/staging` 后覆盖同一目录；扩展 ID、Staging API 和本地账号授权保持不变。用户在 Chrome 重新加载后负责真实 X 验收；Codex 不以自动化结果代替用户确认。恢复命令继续使用上文保留的 `restore-staging-stable-20261027-204918-82754.command`。

## 2026-10-28：页面驻留稳定性修复候选（等待用户真实 X 验收）

### 根因证据与边界

- 对 `cec9d3f` 的检查确认：`activationTainted` 在未绑定超时/竞争后会置为真，点击捕获随后静默拒绝新帖操作，源码没有清除路径。这是可复现的永久锁定代码缺陷，能够解释“刷新后恢复”；但用户报告有时自行恢复，故尚不能认定它解释了每一次现场故障。
- 修复前新增的两项 DOM 流程回归均失败：未绑定获取超时后页面已空仍拒绝新点击；以及竞争操作结束、旧弹窗关闭后仍拒绝下一次点击。

### 候选改动

- 改为 `recoveryRequired`：拒绝当前会话后，下一次可信点击只会在可见 dialog/editor 均为零时清理旧会话资源并恢复；旧回复框仍可见时继续 fail-closed。
- 保留最多 8 个已拒绝来源的短期内存快照，用于拦截没有状态链接且正文相同的迟到弹窗；快照不持久化，也不写入诊断日志。
- 增加相对时间、匿名会话序号、可信手势/Reply 指针与点击计数、超时、生命周期、编辑器、浮窗挂载状态和 runtime context 诊断。`globalThis.__xrhStagingDiagnosticReport()` 仅输出状态枚举、布尔值、计数和相对时间；不包含帖子/回复文本、URL、用户或请求 ID、Token、Cookie。
- 保留 9 秒关联期限、60 秒单次会话期限、草稿保护、唯一编辑器/焦点/帖子关联校验、旧异步响应隔离和单次填入检查。

### 自动化验证

- 专项 DOM 状态机/关联/输入测试：56/56 通过。
- 全量 `npm test`：600/600 通过；包含 Staging Pages 构建并确认生成资源使用 Staging API。
- 测试包含 30 秒、90 秒、3 分钟、5 分钟虚拟空闲、60 秒会话过期、弹窗关闭延迟、真正竞争、旧响应迟到、旧来源同文案隔离和诊断脱敏。虚拟时间测试不是浏览器真实 5 分钟驻留测试。
- Staging 构建 ID：`staging-lifecycle-20261028-1`；manifest 没有 `debugger` 权限，产物无 `chrome.debugger` 调用，Host 权限仅为 `https://api-staging.x-reply-helper.top/*`。本次加载配置为 `associationOnly:true`，不请求 AI、不填入文字，避免消耗额度。

### 安装与回滚

- 候选已放回原加载路径 `/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging`，路径不变；原扩展 ID `kaaehkpihjenlhjjfjcopkjhegmfmchk` 和 Staging API 不变。需要在 `chrome://extensions` 对该扩展点击“重新加载”后生效。
- 本次替换前完整备份：`/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging-pre-lifecycle-20261028-1805`。
- 一键恢复替换前版本：`/Users/xuyaoyang/x posst/apps/reply-copilot/dist/restore-staging-pre-lifecycle-20261028-1805.command`；运行后再次在 `chrome://extensions` 重新加载。
- 现有稳定版回滚脚本 `restore-staging-stable-20261027-204918-82754.command` 保持原样。

本候选处于“待用户真实时间维度验收”，不能标为已解决。用户可在同一 X 标签页先闲置 90 秒、再测试回复入口；随后完成一次回复框打开/关闭，再闲置 3–5 分钟并重复。该构建仅验证身份关联，不调用 AI。若浮窗缺失，在 X 页 DevTools 的 Console 执行 `copy(__xrhStagingDiagnosticReport())`（先将执行上下文切到该 X 页的 Staging `content-script.js`），把复制的脱敏摘要发回即可。真实 X 的后台标签、Chrome 休眠与长时间驻留仍需用户现场验证。

## 2026-10-28：真实 Chrome 日志确认首页编辑框阻塞恢复

用户反馈 `12f9937` 的真实 AI 构建仍然在后续操作失去浮窗。直接读取当前 Chrome/X 的 DevTools 取得了实际失败路径：匿名会话 13 在相对时间 105818ms 因 `reply_context_unconfirmed` 被拒绝；随后原生回复点击仍被监听，但始终停在 `awaiting_quiescent_page`。真实日志在旧弹窗已关闭时反复显示 `visibleDialogs=0, visibleEditors=1`。通过页面只读 DOM 元数据确认，唯一可见编辑框位于 dialog 外，是 X 首页常驻发帖框。

上一候选的恢复条件错误地要求整个页面不存在任何编辑框，因此首页常驻框导致恢复一直无法通过。本轮将可见回复编辑框数量与页面全部编辑框数量区分：只要求回复 dialog/editor 已关闭，同时继续把所有原有编辑器节点加入下一次点击的 baseline，禁止把常驻或旧节点当成新回复框。真实多个弹窗、已有草稿、同文案迟到弹窗和旧请求保护保持原样。

同时复现了上一轮改动引入的空值回归：modal 初始只有编辑框、原帖副本 article 尚未渲染时，`contextId(undefined)` 会抛异常。新增真实 Chrome fixture 在修复前无法完成，恢复 article 空值保护后正常返回等待状态。等待仍受 9 秒上限约束，不降低身份校验。

- 首页常驻编辑框恢复回归：修复前失败，修复后通过。
- 真实 Chrome DOM fixture 增加常驻编辑框、独立回复编辑框计数与空弹窗壳，共 14 个断言；真实 Chrome 粘贴/编辑/撤销 fixture 通过。
- 全量自动化：601/601 通过；专项状态机/输入测试 57/57 通过。
- 新诊断构建标识 `staging-recovery-scope-20261028-2`。`reply_context_check` 只记录 article 数量、是否存在正文、正文比较是否一致、是否有状态链接以及焦点布尔值，不记录内容或标识。
- 最初那次 `reply_context_unconfirmed` 的具体 DOM 差异在旧日志中没有足够字段，仍未定位，不能以本次恢复修复声称所有帖子形态都已通过。下一次同类拒绝可区分多 article、正文不一致或焦点变化。

已查询 Chrome 官方 Content scripts、Service Worker lifecycle 及 MDN MutationObserver 文档。此次实际日志显示内容脚本持续收到可信点击，修改依据为已确认的恢复条件错误；未引入后台常驻、无限重连或循环生成。

本轮候选继续开启真实 AI（`associationOnly:false`），无 debugger 权限或调用；已放回原 Staging 目录，并保持 ID 和 API。安装前备份：`/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging-before-recovery-scope-20261028`；一键回滚：`/Users/xuyaoyang/x posst/apps/reply-copilot/dist/restore-staging-before-recovery-scope-20261028.command`。最终候选文件替换后需重新加载对应 Staging ID，并对 X 刷新一次以加载新版内容脚本；本轮尚未完成用户长时间真实使用复验，不宣称完整解决。Production、正式 PR、商店审核与 0.3.2 发布准备保持原状。

## 2026-10-28：插件交付确认收尾候选（后端保持不动）

源码确认一个可复现的风险：回复框关闭时取消了生成 fetch，但服务端可能仍在生成，且插件没有继续原请求的 delivered 确认。后续使用新请求 ID 会被预占保护拒绝。界面截图本身不能证明每一次阻塞都来自这条路径。

本轮只读查询发现 Staging 有一笔 reserved/generating、consumed=0、没有结果过期时间的旧请求，查询时已超过17分钟。用户明确选择仅修复插件，不授权修改后端。该旧记录没有被解除；刷新页面或安装插件也不会清除它，不能宣称当前账号阻塞已经恢复。

新增 Staging 专用交付协调器：提交后不随编辑框取消而中断有界的原请求交付；旧响应仍受内容脚本会话校验保护，不得填入新编辑器。按账号在可信 extension session storage 保存原请求 ID 及不可变输入；确认响应丢失后，在下一次用户操作中最多尝试一次原请求恢复，不循环重试，不生成替代 ID。相同 ID 重试沿用原风格和历史快照，避免动态设置导致幂等冲突。成功结果最多保留4条、读取时排除10分钟前的数据，浏览器会话结束清除；不写日志、不包含凭证，不宣称已加入用户历史。取消界面后的有效生成仍可能完成正常交付并消耗一次额度。

此协调器仅覆盖页面内后台生成路径；侧栏仍遵循原业务流程，服务端并发保护不变。无法恢复没有原始输入快照的旧请求，也不绕过服务端预占保护。

- 全量 npm test：611/611 通过，0失败；包含实际打包后台取消/排队测试、共享 HostedAIClient 丢失确认响应及幂等测试。
- 未发出真实 AI 请求，未修改 API、D1、额度、Worker 或 Production。
- 构建标识：staging-delivery-recovery-20261028-3；associationOnly=false，Staging API不变，无debugger权限和调用。
- 候选安装路径仍为原 dist/staging；备份 staging-before-delivery-recovery-20261028，一键回滚 restore-staging-before-delivery-recovery-20261028.command。重新加载扩展并刷新 X 一次才能加载新版内容脚本，刷新不能清除旧服务端请求。

交付状态：插件候选已准备，等待用户真实使用验证；旧服务端请求仍是独立阻断项，本轮不处理。

## 2026-10-28：用户追加授权清除 Staging 旧请求阻塞

用户随后要求“把那个阻塞去掉”，授权处理此前明确说明的 Staging 后端收尾。新增仅限 ENVIRONMENT=staging 的超时释放：生成超过10分钟（上游请求超时25秒）、无原始结果/交付确认、consumed=0、仍有reserved allocation，才可收尾；兼容定时任务曾标记为uncertain的同类请求。正常生成、已有结果、已扣次、Production均不受此路径影响。

使用单次随机claim标记和D1原子batch同时收尾请求、释放账户/批次预占、写零余额变动的generation_release审计；不增加余额、不生成退款。未知上游实际成本以原预估额保守结算，避免放开成本预算。事务一致性断言失败时整批回滚。迟到上游结果不能复活已释放请求。正常已认证/v1/usage及下一次生成会在当前用户范围内执行；不增加公网维护入口、不绕过登录。

回归：新增11项，含修复前失败的reserved/uncertain超时恢复、幂等、近期请求/有结果/已扣次保护、Production隔离、未登录和跨账号保护、预算不一致回滚、迟到完成不扣次。全量622/622通过，API类型检查及Staging Wrangler dry-run通过。线上原版本回滚依据：6efab2b5-4a3e-4238-8619-34166f3a3578。只部署Staging，无迁移、不操作Production。

### 本次线上执行结果

- 代码提交 b4630bccd3d64672069149082bac1d9a8f3f8a3c；Staging部署 e3de8e40-fd6d-4834-b12f-ab017eb0bf09，health正常。
- Chrome当前会话控制持续超时/用户切换窗口，未提取Cookie或凭证。临时增加每分钟scheduled触发现有cleanup后，已通过同一原子收尾逻辑处理旧请求，并恢复唯一原调度0 3 * * *。
- D1只读后验：stuck=0、generation_reserved合计从1降至0；免费余额合计179、付费余额合计1200，前后不变；generation_release新增恰好1条、free_delta=0及paid_delta=0；原请求安全关闭、consumed=0。未直接执行财务UPDATE、未调用真实AI。
- 用户可重新生成；若界面仍显示旧提示，关闭旧回复框后重新点击回复。插件候选仍需在Chrome重新加载并刷新X一次；不把后端阻塞解除等同于真实X长期稳定性验收。
