# 小豆新 API 接入差异评审｜Reply Copilot｜2026-11-10

**范围**：只分析用户上传的 XD-OP-01..15 原文与 GitHub 当前已知 Production 运行源码 `d59a1a56720c71a2dde02b777fadb984533283a6`。本次不改业务代码、不部署、不运行远程 D1 SQL、不发起支付。来源全文保存在 [15 篇原始文档](./vendor/xiaodou/2026-11-10/README.md)。

## 1. 文档确实说了什么（不等于商户已开通）

1. **原生 Open API v1 七接口**：RSA2 六头 `XD-Signature-v1`；下单 `POST /api/open/v1/payments`、重拉起 `POST /payments/{outTradeNo}/attempts`、查单 GET、关单 POST、退款 POST、退款查询 GET，以及 `GET /api/open/v1/settlement/accounts`。真实 BASE URL 必须从商户门户获取，不能猜 host；应用 `appId` 与商户自身 `mkid_` 来自上传公钥，平台公钥以独立 `kid` 校验响应与事件。
2. **新商户微信 JSAPI / 平台桥接**：商户直收的微信单在平台已完成公众号 appid/授权目录读回后，可以**不传** `subOpenid`，将服务端下发 `payUrl` 原样交给微信内买家，平台桥接 OAuth/JSAPI；自管形态可传买家平台公众号的 `subOpenid`，获得 `jsapiParams`。仅在微信内拉起；微信外手机浏览器/自有 App 不支持直接拉起。见 XD-OP-03/06/15。
3. **最新微信首次开通条件**：XD-OP-10 文档 2.5.0（2026-11-09）与 XD-OP-15 说明：新商户**同时**需要连续 7 个自然日每天至少 1 笔成功交易，且保证金净额 ≥¥168，只有在北京时间 08:00–18:00 能进行微信渠道开通/实名；已经开过微信的商户有单独的既有状态规则。平台总体支持不等于**当前账户**或特定 `channel × tradeScope` 获准。支付宝认证后自动开通；需以商户门户为准。
4. **支付金额与分账**：`SELLER` 默认传 `amountFen`；`BUYER` 可选 `feeBearer=BUYER` + `merchantAmountFen`，由平台计算买家实付，且可能因闸门返回 `OPEN_API_FEE_BEARER_DISABLED`。每单 `feeProjection` 为历史定价/结算口径，不硬编码费率，`GET /settlement/accounts` 为只读，后台修改收款分配，逐单创建时冻结。
5. **易支付兼容面**：`submit.php` / `mapi.php` 下单，`api.php?act=order` 或 `act=query` 查询；支持支付宝，资料也列微信 `wxpay` 但仅微信内 JSAPI 且商户权限有效；兼容面无自动退款 API，运营退款申请走门户或对接人。XD-OP-13 对 `api.php` 仅列查询入口与 `status=1`，未给出完整、足以据此建立资金信任的查询身份认证及返回字段核验合同；需要继续向官方核实，绝不可仅凭状态字面给额度。
6. **来源与 webhook**：商户 API 来源 IP 白名单**默认开启**；`403 OPEN_API_SOURCE_IP_REJECTED` 有平台边缘与应用白名单两种原因，非所有 403 都靠加白解决。原生 `notifyUrl` 由门户应用级设置，非建单字段；未设置时根本不产生事件，事后不能简单要求补推。事件必须验原始 body 签名、`eventId` 幂等落账，成功回执正文精确为 `success`；查单作为通知遗漏补偿。旧易支付兼容面的回执大小写不敏感。
7. **请求、重试与异常**：所有 POST 带 `Content-Type: application/json`；签名用真实字节。重试复用请求级 `requestId` 与相同 body、但新 nonce；`outTradeNo` 业务幂等。`UNKNOWN` 不是失败，不能换号重下单；`CLOSED/FAILED` 仍可能被后续可信成功事件提升为 paid。按照错误码分别处理 `401` 签名、`403` 来源/商户状态、`409` 幂等/经营限制、`422` 通道与范围、`429/503` 退避。

## 2. 与项目当前代码/运行状态的差距

| 范围 | 当前已知状态 | 新文档引出的行动 |
| --- | --- | --- |
| 新商家选择 | D1 `active_merchant` 的上次验证值为 mk99；Production 实际订阅/额度包新购走 MK99；`PAYMENT_PROVIDER=xiaodou` 是旧兼容变量 | **不要**因为变量含 xiaodou 就推定小豆正在新购 |
| Production 凭据 | 2026-11-10 只读 CF Worker settings 显示无小豆 RSA2/Epay secrets；Staging 有对应秘密绑定 | 仅 Staging 核验；任何 Production 注入/切换必须另行授权，不搬运 Staging key |
| 小豆 RSA2 | `api/src/xiaodou.js` 已具备签名、下单、查单、重拉起、关闭、退款/Webhook；`payment-policy.ts` 有 RSA2 支付宝/微信独立放行门禁 | 对照新的严格 body、`tradeScope`、`feeBearer`、bridge 模式/optional subOpenid、响应字段扩展，新增本地合同与回归测试；**不得当已验收的真收款** |
| 小豆 Epay | `api/src/epay.js` 以 `type=alipay` 构建表单；`payment-policy.ts` 只暴露 Epay 支付宝；刷新订单主要 local-only | 可评估 Epay API 查单和经准入的微信，但需官方完整认证合同；不得按 `status=1` 单字段发权益 |
| 订阅 | `api/src/subscription-checkout.ts` 明确强制 `activeMerchant==='mk99'` | 小豆不能直接替换全局商户而不影响在售订阅；未来需分产品独立商户路由并回归 |
| 网络出口 | 历史小豆 RSA2 平台 source-validation 拒单尚未有成功根因闭环；Cloudflare Worker 出口不可假定固定 | 首先利用官方错误码+ `details.reason` 分类来源边缘/白名单；与平台确认安全可审计的固定出口方案，不绕过代理/伪造头或默认关白名单 |
| Webhook/订单 | 历史小豆订单、签名验签、幂等与原有回调代码保留 | 保持原回调始终可处理，不依据新建单关闭旧通知；独立演练漏通知查单/退款、乱序事件、双渠道同名、切商家并发 |
| 自动化 | 目前只审阅文档，没有执行本地测试/环境验收 | 新版并不自动赋予产品现有能力；按分批 Staging 计划、CI 同 SHA、真人验收推进 |

## 3. 优先级与实施序列

- **P0 商户准入事实**：由经营者核对卖家门户上的已开通支付宝、微信首次开通进度、保证金净额、最近 7 天成交、`channel × tradeScope`、应用状态、`notifyUrl` 是否已生效、商户 API BASE URL、来源 IP 白名单、平台公钥指纹。不要把凭证/真实 IP/私钥粘贴在 Issue 或 Notion。真实权限与费用合同只能以门户或平台明确回复为准。
- **P0 Staging 离线协议复核**：参考 XD-OP-09 签名 golden vectors，严格测试 GET 无 Content-Type 的空行、POST 无体仍带 JSON Content-Type、签名/nonce/requestId、响应验签缺头、未知字段 400、差错码分类以及金额语义。
- **P1 Staging 适配与测试（需要明确开发任务）**：新增微信桥接与终端 UX、可选 tradeScope/BUYER 报价、易支付可信查单方案的独立审查；按 SDK 子功能逐项接入，不重写已有资金账本；原来 MK99 保留。
- **P1 真实收款前门禁**：确认出口、通知/查单、隔离演练及可回滚路径。任何真人付款、退款、商户审核、线上开关、Secrets/生产 D1/部署都需要有针对性的明确授权；远程 D1 SQL（包括 SELECT/PRAGMA、clone）没有本次授权。
- **P2 上线运维**：告警、账务净结算对照、订单人工核查与退款工单、定期查单补偿，完善独立商户/产品路由而不打断现有 MK99 订阅。

## 4. 资料与未决事项

- 用户上传的是 **15 篇 Markdown**，不是完整供应商公开仓/Skill 包；缺 `README.md`、`MANIFEST.json`、`examples/`、`demo/`、`releases/`。文档里提及的示例/golden 代码不能假装已经取得。
- `XD-OP-10` 最新列文档 **2.5.0（2026-11-09）**，大多数篇章 header 仍为 `version: 1.0.0`，第 15 篇 header 为 `2.4.0`；不把二者自动合并为统一的供应商版本，需以本次原始快照及后续来源核实为准。
- 来源：用户提供资料快照，不是平台账户实时状态。未取得真实支付成功、漏通知补偿、实际佣金费率/净额或当前微信开通的独立证明。
