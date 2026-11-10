# 小豆支付原始文档归档（收到：2026-11-10）

> **只读资料快照，不代表项目已实现或商户已获准收款。** 本目录保留用户上传的 15 份 Markdown 原始文本，除上传文件名的 `(3)` 去重后缀外不修改原文；因此原文相对链接仍可在本目录互相跳转。
>
> 上游来源：用户于 2026-11-10 提供的官方资料包；此处并未独立认证文档发布渠道或当前商户资格。不要把本文视为已验证的在线实时 API 配置。

## 快速入口

- [01 快速开始](./01-quickstart.md)
- [02 接入指南与域名/IP](./02-integration-guide.md)
- [03 API 参考与字段合同](./03-api-reference.md)
- [04 错误码](./04-errors-and-troubleshooting.md)
- [05 Webhook 验签](./05-webhook-verification.md)
- [06 收银端能力矩阵](./06-cashier-integration.md)
- [07 费率、限额与费用承担方](./07-fees-and-limits.md)
- [08 退款与对账](./08-refund-and-reconciliation.md)
- [09 安全红线](./09-security-redlines.md)
- [10 变更日志（最新列示：文档 2.5.0 / 2026-11-09）](./10-changelog.md)
- [11 上线检查清单](./11-go-live-checklist.md)
- [12 凭证和密钥轮换](./12-credential-key-management.md)
- [13 易支付兼容协议](./13-epay-compat-integration.md)
- [14 到账账号和分配只读接口](./14-settlement-accounts.md)
- [15 微信 JSAPI 配置及平台桥接](./15-wechat-jsapi-setup.md)

## 审查与接入决策

详见 [Reply Copilot 专项差异与安全评审](../../xiaodou-2026-11-10-integration-review.md)。请把新协议能力与已经上线的支付能力分开，不改动历史商户支付通知/账本与已运行的 MK99 订阅。

注意：资料内部分链接指向上游未随这 15 篇提供的 `README.md`、`MANIFEST.json`、`examples/`、`demo/`、`releases/`；本快照没有伪造这些缺失材料。文件各自 `docId` header 普遍显示 `version: 1.0.0`，第 15 篇显示 `2.4.0`，但第 10 篇变更日志的最新条目是「文档 2.5.0」；不要将此差异擅自统一改写。

## 上传原文完整性（SHA-256）

下表为用户上传的原始文件字节的 SHA-256；GitHub 保存时只去掉文件名后缀 `(3)`，并保留原文件末尾换行。

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| [01-quickstart.md](./01-quickstart.md) | 8762 | `b0816918b42258b255f7d3d8e4ed1035f2afbd86dd6bd34b71a090284da5c582` |
| [02-integration-guide.md](./02-integration-guide.md) | 14543 | `f4127e4b5e4df751aaebac1766f87aef7e73f5a634618dc60de29369c3a1744e` |
| [03-api-reference.md](./03-api-reference.md) | 23325 | `89727b5149438af2a2bc9bda1629980bf6339faccd5e8417894ec712641641f6` |
| [04-errors-and-troubleshooting.md](./04-errors-and-troubleshooting.md) | 12594 | `c37bc2fb364ae358246a829c9a6e327b569b8af92f803eb3ecfafcdc1ac7f6a9` |
| [05-webhook-verification.md](./05-webhook-verification.md) | 11162 | `13d1f8416ce1cba54af3db7e773af9bd8e2259da535e22c73af3aba3e87b77b4` |
| [06-cashier-integration.md](./06-cashier-integration.md) | 9865 | `27632c3d8ecdea68636519d0ea66df4b8337d12e5ed5c600427c85f071fef2c9` |
| [07-fees-and-limits.md](./07-fees-and-limits.md) | 8910 | `e797b401667a07cc324c41ca5d2474039542e46ad16009a3268baa82e3373e68` |
| [08-refund-and-reconciliation.md](./08-refund-and-reconciliation.md) | 4958 | `7e6087070cd3479d0fc13c3b73112305bfc8c032b3f2b8e33e7382cebc40acad` |
| [09-security-redlines.md](./09-security-redlines.md) | 9893 | `bbee474af6f5ba6b3091c8fd814c0e098d1597dfeb0efacfb8b7b6f7c21703f0` |
| [10-changelog.md](./10-changelog.md) | 58379 | `67167c68e6eb82560dd442b81ff040785a9df701ba20e079ef9ba0b7d474bb5b` |
| [11-go-live-checklist.md](./11-go-live-checklist.md) | 9806 | `f657d3683fc4a07d2175aac2f9c0243bc56e71862f7b04a1668c8fb23c23cac3` |
| [12-credential-key-management.md](./12-credential-key-management.md) | 10021 | `032e15fa09bf3415774e51716d4b8afdb472c3e210004a69c3172cc95eef20a9` |
| [13-epay-compat-integration.md](./13-epay-compat-integration.md) | 14498 | `5de077436ca26d4a857795c527232d8bd635dabd9af96d4b6ee756686f32049c` |
| [14-settlement-accounts.md](./14-settlement-accounts.md) | 7681 | `84744968a739b81421d58250df3ac8b2cffd6494046ceef703fe59fe14f88f35` |
| [15-wechat-jsapi-setup.md](./15-wechat-jsapi-setup.md) | 8474 | `e1c4dc21fade3c47bbca3c038d29bb1a2c32f490c7ac1615ccd46fb3b94b4307` |
