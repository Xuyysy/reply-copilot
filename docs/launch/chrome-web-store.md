> 历史商店记录。当前 Production 状态与唯一发布清单见
> [`production-readiness-2026-10-25.md`](production-readiness-2026-10-25.md)。旧草稿包/路径不能直接视为可公开上传版本；先按当前正式配置重建并扫描。

# Chrome Web Store 上架材料（2026-10-22）

## 可直接使用的文案

名称：x-Reply-Helper

简短描述：在 X 上用你的语气生成三条可编辑回复草稿，由你选择、修改并亲自发布。

完整说明：
- 在 X 帖子的回复场景中识别当前帖子文字和链接，生成自然、幽默和观点三种草稿。
- 可设置语言、长度、语气，主动添加个人写作样本。
- 选择候选后插入回复编辑框；本产品不会点击发布，不批量自动回复。
- 使用网站账户登录并绑定插件；生成成功且服务端确认交付后消耗一次额度。
- 不推断未读取的图片、视频或完整对话；请检查事实、措辞和隐私后发布。
- 需要联网和网站账户。免费赠额及付费次数包以官网当前说明为准；实际结算币种为人民币。

## 权限说明（对应实际 manifest）

| 权限 | 用途 |
| --- | --- |
| contextMenus | 对用户主动选中的 X 文本生成草稿 |
| storage | 保存风格、样本、偏好、有限历史及账户绑定令牌；限制为可信扩展上下文 |
| sidePanel | 显示回复候选、账户及错误提示 |
| clipboardWrite | 用户点击复制时写入所选草稿 |
| debugger | 用户明确选择插入后，短暂连接当前 X 标签，仅调用 Input.insertText，完成或失败后断开；不发送按键发布、不读取网络或 Cookie |
| 正式 API host permission | 向本产品 Worker 发送认证、生成与额度请求；打包时替换开发地址，不直接调用模型 |
| x.com / twitter.com content scripts | 当前帖子的文字、状态链接与回复编辑框识别，不扫描私信或其他网站 |

不要因权限敏感就隐藏 debugger 的用途；提交审核时提供“选中草稿→插入→仍需用户发布”的演示。权限已实际使用，删除前须替换并验证插入机制。本轮未改动该机制。

## 隐私披露建议（提交者逐项核实）

披露账户邮箱/标识、认证信息、用户主动提供的写作样本和选择的帖子内容/链接，以及功能所需的页面交互；即使只在本地保存也需如实申报。不能勾选“完全不处理用户数据”。内容经自有 API 发送至 DeepSeek；不出售数据，不用作广告，不访问 X 密码、Cookie 或私信。商店描述、隐私页与问卷必须一致。

保留口径：扩展本地风格/历史保留到用户清理或卸载；服务端回复暂存10分钟供幂等重放，清理由定时任务执行（不是恰好第10分钟物理删除）；完成请求元数据由30天清理策略处理；交易/审计按经营者适用的保留义务处理。不要承诺 DeepSeek 未经确认的零保留或不训练政策。

正式提交前必须补齐经营者名称、客服/数据删除联系邮箱、适用保留期限，并由本人确认发布隐私政策；目前网站隐私页仍标注草案，不能当已完成合规审查。

## 稳定 ID

先在 Chrome Developer Dashboard 上传草稿 ZIP（不发布），取得条目 ID 与 Package → View public key 的 base64 公钥。不要生成另一把密钥来假冒同一 ID。将去掉 PEM 标题/换行的**公钥**保存本机文件。

```sh
REPLY_COPILOT_WEBSITE_URL='https://正式网站域名' \
REPLY_COPILOT_API_URL='https://正式API域名' \
REPLY_COPILOT_EXTENSION_PUBLIC_KEY_FILE='/本机/商店公钥.txt' \
REPLY_COPILOT_EXTENSION_ID='商店32位ID' npm run build:production
```

构建会校验公钥/ID一致并写入产物 manifest.key；只允许公开 RSA SPKI，不接受私钥。源码默认开发 manifest 不等于上架包。未提供公钥时仍可构建草稿，但不能声称 ID 已固定。正式 API 的 EXTENSION_ORIGIN 必须与条目 ID 完全一致；Staging ID 不能冒充商店 ID。

## 仍须本人完成的材料

- 商店开发者账户、经营者/联系邮箱及隐私公开网址确认。
- 实际插件截图：三条候选、风格设置、插入后尚未发布（使用自己的内容或获得许可的示例）。不要展示账号或支付材料。
- 商店要求的128px图标、小型宣传图和至少一张截图；不要用虚构 UI 代替实际功能截图。
- 单一用途、权限用途、数据披露与 reviewer 操作说明/可用测试账户；不要把密码写入仓库。
- 最终 ZIP、审核与发布时间由本人决定。本轮不上传或发布。

参考：
https://developer.chrome.com/docs/extensions/reference/manifest/key
https://developer.chrome.com/docs/webstore/images
https://developer.chrome.com/docs/webstore/program-policies/user-data-faq

## 本次交付包与截图清单

`dist/release/reply-copilot-staging-0.3.0.zip`（manifest位于ZIP根目录）已做完整性校验，含45个文件，不含服务端代码、支付Key或模型Key。它只用于本机Staging验收，不再用于新的商店草稿，**不是指向Production的最终公开包**。

建议本人真实X验收时截取：①英文原帖+三条不同候选；②中文原帖+个人风格；③候选插入编辑框、发送按钮未点击；④设置页（不包含邮箱/Token）；⑤网站套餐/账户余额只用本人同意公开的示例。删除/遮盖个人账号信息和支付材料，不能把Mock结果宣传为真实AI质量证据。

图标128×128；小型宣传图440×280必需；至少一张实际功能截图。未生成/上传真实X截图，不将此项标记完成。尺寸以Chrome商店当前官方要求为准。
