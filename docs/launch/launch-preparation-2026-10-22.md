# 正式上线交付与阻断（2026-10-22）

本文件取代此前描述real-test/$0.05/每日10次/恢复Mock的历史上线指令。当前Staging继续真实AI、普通用户业务流程及后台运营预算。

## 远端已核实（只读）

- Worker `0bbc895c-85bf-443f-a756-d0fd4deacd57`，100%；Pages `6e6ad26b-ff04-4c5e-9c7c-79ee4cba3b01`，success。
- AI_MODE=production、PAYMENT_PROVIDER=xiaodou_epay、PAYMENTS_ENABLED=1、后台purchase_enabled=1、Webhook1、admin1、诊断0；运营预算5000000微美元/UTC日。Staging只有本人测试的现有设置保留，没有重新收紧。
- D1 `cd44bb44-b525-42c4-b286-2cc84dae7fdb`，0001–0012已登记。16个Secret名称存在，未读取或旋转值。
- 当前账户仅有Staging Worker/Pages/D1；没有已创建的同名Production资源。不要从D1元数据的version=production推断它是业务正式库，该字段是D1引擎版本。
- 根域和www已有多个代理A记录，归属未知，**不得覆盖**。api-staging为Worker Custom Domain，staging为Pages域名，Zone普通Worker Routes为空。
- 选择无现有DNS/CustomDomain绑定的 `app.x-reply-helper.top`（站点）和 `api.x-reply-helper.top`（API）作为拟上线地址；未创建记录，最终可在发布授权时确认。无需购买新域名。

## 测试数量来源

对照本机旧报告xrh-final-launch-tests.log、xrh-production-equivalent-tests.log：400→397为删除16项旧real-test/私有购买白名单测试并增加13项普通业务用例。不是单纯删3项。

替代覆盖：普通用户超过10次真实请求构造、即时预算、余额不足、上游402/401/429/500、余额释放、请求重放、环境和DB购买开关、会话/CSRF、禁旧RSA2重拉起。旧指定邮箱/限定预算等测试不再对应产品行为。既有Webhook/金额/额度批次/退款账本测试保留。上轮列表新增2项得到399；本轮另增4项商店包和Production预检测试，403项全部通过，日志为/private/tmp/xrh-store-preparation-tests.log。

另外修复api/package.json的test:ai仍引用已删除real-test-policy测试文件的问题，改为business-ai-mode；这不改任何生成规则。

## 商店草稿

`dist/release/reply-copilot-store-DRAFT-0.3.0.zip`，46文件、ZIP根目录manifest。只连接上述拟正式域名，不连接Staging、不含模型/支付Key。审计摘要在store-draft-audit.json，含ZIP与每文件SHA-256；工作区dirty，HEAD本身并不代表完整包。

**只上传草稿，不点击提交审核或发布。** 目前正式API未上线，公钥/ID未固定，不能把“可上传”理解为“可发布”。不要上传旧reply-copilot-staging ZIP。商店草稿包与Staging构建保存在不同目录，脚本检查拦截Staging目的地。

Google后台操作：
1. 进入 https://chrome.google.com/webstore/devconsole ，使用本人开发者账号；如未完成开发者注册，由本人完成身份/联系资料和条款。
2. 点击 Add new item / 添加新项，上传上面的store-DRAFT ZIP，保存草稿。无需发布即可获得ID。
3. 在条目/Package页复制32位Item ID；点击View public key，复制PEM标题之间的base64内容，去掉换行后保存本机公开公钥文件。**不是私钥，不生成替代密钥。**
4. 向Codex提供ID和公钥文件路径；重新构建时校验ID、公钥、Production EXTENSION_ORIGIN三者一致。
5. 填商店描述、单一用途、每项权限原因、隐私披露、客服、公开隐私网址、分发范围和审核操作说明。debugger用于用户选择后Input.insertText，不读取网络/Cookie、不点击发布；该敏感权限可能延长审核。
6. 准备实际功能截图至少1张（1280×800或640×400）、440×280宣传图和128×128图标。不要用Mock截图证明真实AI质量，不包含邮箱/支付材料。
7. 正式资源和普通用户真实X验收通过后，单独确认提交审核/公开发布；不要因草稿已上传就公开。

资料依据：https://developer.chrome.com/docs/extensions/reference/manifest/key 、https://developer.chrome.com/docs/webstore/cws-dashboard-privacy 、https://developer.chrome.com/docs/webstore/images 。

## Production配置和发布

- `api/deploy/production.wrangler.json`为独立本地发布候选；不改当前wrangler默认Production占位环境、不影响Staging。采用真实AI、保守费率0.30/1.32、Epay、购买0、管理员0、通知1、InvocationLogs关闭且query脱敏。
- UUID和商店ID故意保留阻断占位。`node scripts/production-preflight.mjs`只验证本地全部迁移及发布参数；缺少真实D1/商店ID时以退出码2停止，不能直接发布。
- `node scripts/store-release.mjs`可重建草稿；正式ID取得后通过现有REPLY_COPILOT_EXTENSION_PUBLIC_KEY_FILE/REPLY_COPILOT_EXTENSION_ID环境变量注入公开元数据。
- `node scripts/deploy-production.mjs --check`默认只做预检；`--worker/--pages`只在后续正式授权且明确确认目标后运行。本轮没有运行发布动作；该脚本不创建资源、不迁移远端、不录入Secret。

后续获授权后按顺序：
1. 创建reply-copilot-production独立空D1，核对实际UUID后填候选配置；绝不导入Staging备份、用户、角色、会话、订单和额度。
2. 使用api cwd，`npx --no-install wrangler d1 migrations list DB --config deploy/production.wrangler.json --remote`，核对目标后按0001–0012 apply。空库迁移本地已验证，包含购买默认关闭、管理员为空、业务数据为空、默认运营预算$1/日；正式预算由本人/后台设置，不复制测试余额。已有正式库则先备份和恢复校验。
3. 通过wrangler secret put交互逐项录入：AUTH_HASH_SECRET、PASSWORD_PEPPER、MAIL_API_KEY、MAIL_FROM、TURNSTILE_SECRET_KEY、DEEPSEEK_API_KEY、XIAODOU_EPAY_GATEWAY、XIAODOU_EPAY_PID、XIAODOU_EPAY_KEY。与Staging分别绑定，不反向读取Secret、不把私钥/RSA2或旧白名单当Epay必需项。已有正式认证库绝不更换pepper。
4. 新建x-reply-helper-production Pages；正式邮件域名SPF/DKIM、Turnstile站点和Secret由对应服务确认，Pages PUBLIC_API_BASE_URL固定正式API，PUBLIC_TURNSTILE_SITE_KEY为真实公开sitekey。
5. 先Worker Custom Domain api再Pages app；不得覆盖根域/www，不添加重叠Route。预检/备份通过后执行Worker、再Pages协调发布；记录版本与HTTP/CORS/会话/无效回调拒绝结果。
6. 正式注册验邮后，按稳定user ID原子设置唯一admin role与site_administrator(id=1)；先核实无其他admin/绑定，审计并单独启用管理员入口。不能复制Staging user ID。该初始化只执行一次，之后日常运营使用后台。
7. 商户确认正式通知 `https://api.x-reply-helper.top/v1/payments/xiaodou/epay/notify` 公网可达；回跳由服务端生成 `https://app.x-reply-helper.top/account/?payment_order=<订单ID>`。回跳不能发额度。关闭购买不能关闭合法回调。
8. 本人批准公开发布及收费后，先普通用户注册/插件/真实AI/扣次，再本人执行一次付款，核对唯一事件、额度批次、账本和自动刷新。Codex不代付；不能对旧UNKNOWN做测试补账。
9. 异常关闭新购买、保留回调/已付款数据/原Secret；兼容代码版本恢复，不反向回滚已发生资金数据。

## 漏通知与用户资料

本地官方13篇文档可证：未收到纯success会自动退避重投，最多8次。无法从该资料证明商户后台有手动“重发通知”按钮；本人需确认该按钮或平台原通知重投支持与时限。订单可信核实后只允许原始官方通知驱动幂等到账，不凭截图、不用后台赠额冒充购买补单。

后台已有客服联系配置；Production需本人确认沿用的邮箱及经营主体、保留期限、数据删除受理流程。网站隐私/条款目前仍标草案，不能擅自宣称已合规。隐私已补明帖子链接及最多20条最近选择回复会用于生成，与扩展本地说明一致；debugger和AI第三方处理需在商店如实披露。

价格以Worker套餐快照为准：USD参考1.49/2.99/4.99；当前CNY总10.06/20.21/33.41，服务费1.5%，不是美元实际扣款。以后后台改价只作用新单。

## 真实浏览器验收边界

本人完成普通账号登录和绑定后，本轮使用真实Chrome/X完成一次生成与插入，未点击X发送。D1确认role=user（非admin），requestId `946afd8c-5dd1-41be-a9ab-f47151228149`：deepseek-flash，输入1065/输出108Token，估算463微美元，1757ms完成交付；三候选非空（23/24/31字符），正式generation_debit唯一1条、总delta=-1，免费200→199、付费0、预占0。订单仍3、支付事件仍1，无新交易。不是Mock或管理员账号代替普通用户的结论。已保留未发送草稿供本人检查。

## 最终验证结果

- 全项目403/403、AI专项21/21通过；API/Web TypeScript、Staging配置检查和候选Production Worker dry-run通过。商店ZIP unzip完整性通过，46文件；最终摘要见dist/release/store-draft-audit.json。
- 普通账号真实X/DeepSeek/草稿插入/扣1已完成，未发送，详见上节；财务只读审计账户/批次不一致0、已付款无唯一流水0、非法批次0，唯一管理员1。
- /health和/v1/packages使用正常浏览器User-Agent均200，paymentAvailable=true；默认Python客户端User-Agent先前被403拒绝，未修改任何安全规则，不能将该客户端403当成Worker宕机。
- 本轮未重新部署Worker/Pages；线上版本仍为本文已核实版本。Production仅本地准备，无资源创建、DNS修改、Secret修改或迁移。隐私补充及中性充值文案为本地发布候选，尚未部署。
- 本机完整保留原有119项dirty路径和ahead14提交；没有提交/推送。HEAD仍65e243db89456d10e93e63d8dc301e1b7bf4068d，发布包以dirty工作树构建，不能仅用该HEAD重建全部功能。

结论：READY_FOR_STORE_DRAFT_UPLOAD。尚非READY_FOR_PUBLIC_PRODUCTION。先上传未发布草稿获取ID/公钥，再确认正式域名与经营资料、单独授权隔离资源部署，最后提交审核和开放收费。
