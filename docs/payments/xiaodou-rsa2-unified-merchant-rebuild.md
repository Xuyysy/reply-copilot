# 小豆 RSA2 全站商家切换｜开发与验收记录（2026-11-10）

> **状态：源码已实现；线上切换尚未开放。** GitHub [Draft PR #38](https://github.com/Xuyysy/reply-copilot/pull/38) 的基础为已在 Production 部署的订阅源 SHA `d59a1a56720c71a2dde02b777fadb984533283a6`。本目录还包含 [15 份上游原始资料](./vendor/xiaodou/2026-11-10/README.md)。所有代码仅在隔离分支，**不能**因 CI 通过就认为商户平台已获准实际下单。

## 用户确认的产品合同

- **一个全局商家选择**：`system_settings.active_merchant = mk99 | xiaodou | none`，同时影响永久额度包与 Basic / Pro / Max / Ultra 的新订单。没有按产品拆分的商家选项，也不自动跨商家回退。
- **小豆新单仅 RSA2 Open API**：支付宝 `ALIPAY_H5` 已由商户方确认开通；微信商户能力**未开通**，保持额外服务器开关 `XIAODOU_WECHAT_MERCHANT_APPROVED !== '1'` 拒绝，不接受单纯后台“已放行”勾选。即便日后开放微信，订阅下单仍需单独完成该形态的专项改造和验收。
- **旧订单独立收敛**：创建时锁定商家、RSA2 appId/kid 标识、买家实付、渠道和商家平台流水。切换后旧 MK99、旧小豆原生以及旧易支付单依其原有验证及人工流程处理；旧易支付不作为任何真实新单候选。

## 当前源码已实现

1. `api/migrations/0025_subscription_xiaodou_rsa2.sql`：D1 增量迁移文件，重建订阅交易的商家 CHECK 并保留旧 MK99 交易与付款证明；备份/还原事件后重新创建原有唯一索引和外键。**已通过本地完整测试，不得未经授权执行远程 D1**。保留 0022/0023 原应用迁移不动。
2. `subscription-checkout.ts`：经同一个 `paymentControl` 选择商家，订单交易原子批次内二次核对当前 D1 商家；小豆独立 RSA2 创建、账户和渠道快照、单次外部下单、签名回执验证、现金 URL 严格 HTTPS 约束；网络不确定保留原单，不重新生成新的支付单。正常 MK99 创建路径保留。
3. `subscription-settlement.ts`：按订单快照的商家执行可信 MK99 查询或小豆 RSA2 **签名 GET**；只有签名查单结果与订单号、商户 app、渠道、金额 CNY 和平台订单身份全部匹配才可调用订阅专用原子 D1-batch 结算。新增订阅周期、排队续订、升级变更、支付事件和用户权益一并约束；不会把订阅金额误算进永久额度包。重复签名查单幂等。小豆的 `CLOSED/FAILED` 不直接最终判死，等待后续可信状态收敛。
4. `payments.ts`：小豆平台门户配置的**同一个应用级 notifyUrl** 兼容额度包和订阅。新订阅签名 webhook 不直接发权益，只会触发原商家签名查单，严格返回 `success`；旧永久额度包、MK99 订阅通知和旧易支付通知均保留。
5. `subscription-account.ts`、`subscription-generation.ts`、`subscription-renewal.ts`、`admin-subscriptions.ts`：接受 **经过签名证据证明** 的小豆订阅状态，继续排除未认证的测试/手写状态；日配额、新旧周期切换及后台只读统计共用证据链。
6. `admin-controls.ts`：后台选择小豆时除 RSA2 密钥、接口和支付宝开通确认，还必须明确设置 `XIAODOU_RSA2_SUBSCRIPTIONS_READY=1` 与 `XIAODOU_SOURCE_IP_CONFIRMED=1`。**默认缺省时拒绝切换**，不会因为切商家导致 MK99 订阅新购被静默关闭。切到小豆后额度包与订阅同时根据同一商家路由。
7. `payment-policy.ts`：真实 Production/Staging 的小豆新单没有 Epay 回退。旧 Epay 的新单路由只允许在保留的模拟回归测试域 `https://api-staging.example.test` 且额外测试旗标开启时使用，无法匹配线上域名；原历史 Epay 通知仍按旧协议验签。商户微信额外服务器侧强制门禁。
8. `xiaodou.js`：兼容新文档单申报可省略、双申报必须填写的 `tradeScope`，可通过服务端配置 `XIAODOU_TRADE_SCOPE` 传入 `CARD_VIRTUAL/PHYSICAL_FACE_TO_FACE`。金额仍使用当前已审查的 **SELLER/买家实付** 模式，不冒险切换到灰度 BUYER 费用合同。

## 本地测试与不变式

- `api/tests/xiaodou-subscriptions.test.mjs`：RSA2 支付宝建单、签名查单到账、跨商家查旧单、金额不匹配失败、微信关闭、UNKNOWN 保留原单、签名回调共享路由、D1 迁移保全 MK99 支付证据、后台切换前置检查、续订与阶梯升级。
- 历史 MK99 支付及订阅、Epay 回调、旧信用额授予、浏览器收银和生产预检测试继续跑全量；以 GitHub PR #38 的 **最新 SHA** CI 为最终依据，任何旧 SHA 的通过不等于新版全通过。

## 环境与上线前必须确认

1. 生产目前只有 MK99 的可用凭据绑定；小豆 RSA2 的 Staging 凭据在位，Production 尚未配置。不复制测试环境私钥到 Production。小豆卖家门户的 **BASE URL**、签名密钥、公钥 kid、回调地址、支付宝 `channel×tradeScope` 放行、金额/手续费口径由运营核对，文档支持 ≠ 商户实时资格。
2. Cloudflare Workers 的出口 IP 不可假设稳定；小豆 API **IP 白名单默认开启**，历史 `OPEN_API_SOURCE_IP_REJECTED` 未消除。需先确认平台允许且可审计的网络来源方案，完成 Staging 可验证的签名读接口和真实小额支付回调/主动查单测试；不关白名单绕过风控。
3. D1 0025 是表重建型迁移，必须先备份、在隔离副本演练并验证旧交易、旧事件和外键引用，之后单独获得环境针对性授权才可应用。尤其禁止在当前对话执行远程 D1 SQL（包括 SELECT/PRAGMA/clone）。
4. 订阅退款当前仍走**人工审核/风险冻结**，尚未提供无监管的自动退款；净结算和平台手续费需继续按卖家真实账单对账，不能把测试签名查单当作资金已到个人银行卡。
5. 只有当对应环境的合规准入、数据备份、签名回调、原商家双向切换和测试报告得到确认，才允许解除默认保护并单独审批 Production Secrets 和部署。

**未做**：真实支付、商户后台通道开通、Cloudflare 写入、远程 D1 SQL、实际商家切换、生产部署、自动退款或微信支付。说明精确反映的是**源码开发/测试状态**，不是现网功能状态。
