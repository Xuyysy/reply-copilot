# 正式上线交付与阻断（2026-10-22）

> **历史快照。** 当前 Production 状态及唯一有效上线清单见
> [`production-readiness-2026-10-25.md`](production-readiness-2026-10-25.md)。
> Production D1 已完成 0001–0017；不要执行本文件中的旧迁移命令或照旧资源状态操作。

本文件取代此前描述real-test/$0.05/每日10次/恢复Mock的历史上线指令。当前Staging继续真实AI、普通用户业务流程及后台运营预算。

## 最新远端基线（2026-10-25，只读核验）

- Staging Worker `reply-copilot-api-staging`：`2fd67173-1785-43f6-8de4-4bac8aec4b23`，100%流量；`PAYMENTS_ENABLED=1`、Webhook=1、`MK99_NOTIFY_DIAGNOSTICS_ENABLED=0`。Staging D1 `cd44bb44-b525-42c4-b286-2cc84dae7fdb`；MK99、支付宝和微信运营开关及放行状态均为1。`/health`=200，`/v1/packages`显示 MK99 支付宝/微信、400次套餐1059分。
- Production Worker `reply-copilot-api-production`：`5a48f3e0-b8be-4cdb-b1c9-ef3c61657bde`，100%流量；API域名健康200。Pages项目 `x-reply-helper-production` 已有 `app.x-reply-helper.top`，当前可见部署 `8cbf234d-4945-4cc3-b3e6-9349b248cbca`；首页、隐私页和条款页均返回200。Production D1 `reply-copilot-production`（`d9df7d23-9b9c-44ac-a33a-c24474c15691`）存在，业务表当前用户、订单、交易、事件、账本、批次和管理员审计记录均为0。
- Production 已应用迁移0001–0013；`0014_provider_channel_independence.sql` 至 `0017_mk99_merchant_pricing_snapshot.sql`仍待增量迁移。远端变量为 `PAYMENTS_ENABLED=0`、`XIAODOU_WEBHOOKS_ENABLED=1`、`ADMIN_PORTAL_ENABLED=0`、`PAYMENT_PROVIDER=xiaodou`；`/v1/packages`=200且`paymentAvailable=false`，D1 `purchase_enabled=0`。
- Production 当前仅核实到 `AUTH_HASH_SECRET`、`PASSWORD_PEPPER`、`TURNSTILE_SECRET_KEY` 三个 Secret 名称。邮件发送、DeepSeek 以及 MK99商户凭证/协议/金额/收银域名配置均未在 Production 配置；未读取任何Secret明文。Staging 配置和凭证未复制到Production。
- 生产站点和API域名已经绑定并可访问，现有资源不得重建。Production Worker、Pages部署来自较旧代码快照，正式发布需在迁移和凭证齐备后，从同一审查过的版本协调更新。

## 历史 Staging 快照（2026-10-22；以下资源与配置记录已被上方最新基线取代）

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

`dist/release/reply-copilot-store-DRAFT-0.3.0.zip`是已有商店草稿包；条目ID已固定为`fgfjajofkapebgphfidblngcjomkbdaj`，公开公钥已提供并绑定到正式扩展来源。需在正式Worker/Pages同步更新后重新构建和扫描最终Production ZIP，确认只连接正式API、不含Staging主机或Secret，再更新商店草稿。

**商店条目仍是草稿；不要提交审核或发布。** 生产API已有基础部署，但支付迁移、MK99配置、管理员和法律/隐私资料尚未完成，不能把草稿包理解为可发布版本。不要上传旧Staging ZIP。

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

- `api/deploy/production.wrangler.json`为独立本地发布候选；当前远端已经存在Production Worker、Pages、D1及`app`/`api`域名，不得重建。线上新购买与管理员入口均关闭，Webhook保持开启。
- 正式D1 UUID和商店ID已确认，但Production仅应用0001–0013；0014–0017待增量迁移。Production运行配置目前选择旧`xiaodou`，若采用MK99须在审查后的部署中切换，并保持购买关闭，直到商户凭证、协议合同、渠道放行及回调验证完成。
- `node scripts/store-release.mjs`可重建草稿；正式ID取得后通过现有REPLY_COPILOT_EXTENSION_PUBLIC_KEY_FILE/REPLY_COPILOT_EXTENSION_ID环境变量注入公开元数据。
- `node scripts/deploy-production.mjs --check`默认只做预检；`--worker/--pages`只在后续正式授权且明确确认目标后运行。本轮没有运行发布动作；该脚本不创建资源、不迁移远端、不录入Secret。

后续获授权后按顺序：
1. 不创建Production资源。先备份现有D1并验证可恢复；核对远端0001–0013，再只增量执行0014–0017，运行只读一致性审计。绝不导入Staging账号、管理员、订单和额度。
2. 单独录入缺少的Production Secrets：邮件服务、DeepSeek，以及选择MK99所需凭证和已核实协议配置。当前远端仅有AUTH_HASH_SECRET、PASSWORD_PEPPER、TURNSTILE_SECRET_KEY名称；绝不读取或复制Staging Secret。已有认证库不得更换PASSWORD_PEPPER。
3. 从同一审查提交协调更新Worker与Pages，绑定既有Production D1和正式扩展ID；配置正式Turnstile公开site key及服务端Secret，不覆盖未知DNS或既有运营配置。部署后验证HTTPS、CORS、会话/CSRF、D1、无效签名拒绝和健康/套餐接口。
4. 正式注册并验证首个账号后，按稳定user ID审计绑定唯一管理员；`ADMIN_PORTAL_ENABLED`只在绑定核实后开启。不能复制Staging user ID。
5. 如Production选择MK99，在商户后台核实Production通知地址`https://api.x-reply-helper.top/v1/payments/mk99/notify`和原通知重投/异常联系人；保留旧易支付回调路径以兼容历史订单。回跳不能作为到账证据，关闭新购不能关闭合法回调。
8. 本人批准公开发布及收费后，先普通用户注册/插件/真实AI/扣次，再本人执行一次付款，核对唯一事件、额度批次、账本和自动刷新。Codex不代付；不能对旧UNKNOWN做测试补账。
9. 异常关闭新购买、保留回调/已付款数据/原Secret；兼容代码版本恢复，不反向回滚已发生资金数据。

## 漏通知与用户资料

本地官方13篇文档可证：未收到纯success会自动退避重投，最多8次。无法从该资料证明商户后台有手动“重发通知”按钮；本人需确认该按钮或平台原通知重投支持与时限。订单可信核实后只允许原始官方通知驱动幂等到账，不凭截图、不用后台赠额冒充购买补单。

后台已有客服联系配置；Production需本人确认沿用的邮箱及经营主体、保留期限、数据删除受理流程。网站隐私/条款目前仍标草案，不能擅自宣称已合规。隐私已补明帖子链接及最多20条最近选择回复会用于生成，与扩展本地说明一致；debugger和AI第三方处理需在商店如实披露。

价格以Worker订单快照为准：USD参考1.49/2.99/4.99；Staging MK99买家实付为10.59/21.28/35.17 CNY，400次套餐已实测10.59。MK99商家承担5%手续费成本补足目前标注为估算，首笔结算单的商家净结算金额仍须在平台账单核对；页面必须明确实际扣款是人民币，不是美元。后台改价只作用新订单。

## 真实浏览器验收边界

本人完成普通账号登录和绑定后，本轮使用真实Chrome/X完成一次生成与插入，未点击X发送。D1确认role=user（非admin），requestId `946afd8c-5dd1-41be-a9ab-f47151228149`：deepseek-flash，输入1065/输出108Token，估算463微美元，1757ms完成交付；三候选非空（23/24/31字符），正式generation_debit唯一1条、总delta=-1，免费200→199、付费0、预占0。订单仍3、支付事件仍1，无新交易。不是Mock或管理员账号代替普通用户的结论。已保留未发送草稿供本人检查。

## 最终验证结果

- 全项目403/403、AI专项21/21通过；API/Web TypeScript、Staging配置检查和候选Production Worker dry-run通过。商店ZIP unzip完整性通过，46文件；最终摘要见dist/release/store-draft-audit.json。
- 普通账号真实X/DeepSeek/草稿插入/扣1已完成，未发送，详见上节；财务只读审计账户/批次不一致0、已付款无唯一流水0、非法批次0，唯一管理员1。
- /health和/v1/packages使用正常浏览器User-Agent均200，paymentAvailable=true；默认Python客户端User-Agent先前被403拒绝，未修改任何安全规则，不能将该客户端403当成Worker宕机。
- 本轮未重新部署Worker/Pages；线上版本仍为本文已核实版本。Production仅本地准备，无资源创建、DNS修改、Secret修改或迁移。隐私补充及中性充值文案为本地发布候选，尚未部署。
- 本机完整保留原有119项dirty路径和ahead14提交；没有提交/推送。HEAD仍65e243db89456d10e93e63d8dc301e1b7bf4068d，发布包以dirty工作树构建，不能仅用该HEAD重建全部功能。

结论：READY_FOR_STORE_DRAFT_UPLOAD。尚非READY_FOR_PUBLIC_PRODUCTION。先上传未发布草稿获取ID/公钥，再确认正式域名与经营资料、单独授权隔离资源部署，最后提交审核和开放收费。
