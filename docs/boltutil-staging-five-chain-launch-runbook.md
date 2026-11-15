# Staging USDT 五链站内支付：上线与人工资金验收门禁

> 状态：代码已测试及 Staging 预览可用；真实用户收款当前 **关闭**。本文档是操作准备，不构成数据库授权。
> 严禁借此次工作修改 Production，或在未获得专门授权时执行任何 Staging/Production D1 SQL（包括 SELECT/PRAGMA/EXPLAIN）。

## 基线与目标
- 已上线候选源：PR #146 上的五链站内收银台。网络 `TRC20`、`POLYGON`、`BEP20`、`ERC20`、`SOLANA`。
- 新增链代币：Ethereum ERC20 USDT `0xdAC17F958D2ee523a2206206994597C13D831ec7`（6位）；Solana USDT mint `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB`（6位）。
- 原有 `api/sql-proposals/0028_boltutil_usdt.sql` 是三链历史原始提案，应保持不可变；五链扩展由 `0030_boltutil_five_networks_staging.sql` 单独升级。
- 站内收银台允许 BoltUtil 的有效订单响应没有 `checkoutUrl`，但收到外部 URL 时仍严格校验 HTTPS BoltUtil 域名；钱包、准确金额、精度、订单身份、服务端过期时间、PENDING 状态必须可靠。

## 资金上线前须逐项取得证据
1. **商户**：在 BoltUtil 商户后台确认 ERC20 USDT 和 Solana SPL USDT 各自启用；分别绑定自己控制的主网钱包；Webhook 及签名密钥有效。不可把代币合约/Mint 作为收款地址。
2. **D1 专项批准**：用户针对 **Staging D1、具体版本的 0030 SQL** 明确单独授权；记录预期数据库 binding ID、当前线上部署 SHA、原三链数据结构，并制定 Time Travel 恢复点、迁移失败停止及人工核验计划。未经批准绝不执行远端 SQL，包括查询。
3. **本地预演**：读取固定历史 0028，执行 0030 本地迁移，验证现有 order/event 数据、唯一索引、FK、五链 CHECK，逐项安全拒绝无效网络；通过精确 SHA 全量 CI。
4. **Staging 切换**：通过单独审批变更所需的 Staging-only 变量 `BOLTUTIL_SCHEMA_READY`、`BOLTUTIL_ENABLED`、`BOLTUTIL_STAGING_CREATE_ENABLED`、`BOLTUTIL_CNY_PER_USDT_MICROS` 及逐条网络 `BOLTUTIL_*_ENABLED`。**只开放已配置商户钱包并完成可追溯对账测试的网络**；禁止一键打开所有网络。继承原有 Worker secret bindings；无需暴露密钥。
5. **人工真钱验收**：由账户所有者主动新建 **一笔** 可承受的 Staging 主网真实订单，核对本网站精确金额、网络、USDT 合约/Mint、真实收款地址、QR 地址文本和有效期；使用正确钱包付款。BoltUtil 的 `CONFIRMED`/`COMPLETED` + 精确金额与地址证据 + 服务端查单与幂等账本一致时才发放权益。验证点击重复、Webhook 重放、原单查回、付款失败与订单过期。
6. **回滚**：发生异常立即关闭 Staging 新建付款开关，保留历史订单/回调和支付证据，不删除任何付款记录、不逆转已发放权益；如迁移涉及数据恢复，仅按事先获批的专门 D1 回滚方案进行。

## 不允许的捷径
- 不得让前端链接指向未经 BoltUtil 返回和服务器验证的收款地址。
- 不得用 `/ping` 200 证明钱包配置就绪，不得用浏览器跳转证明实际付款。
- 不得拿管理员 1 USDT 三链探针成功代替 ERC20 / Solana 真实商户验收。
- 不得未经审批替用户从钱包转账，不得仅凭回调/截图发放额度。
- 不得把 Staging 的支付开关、五链 migration 或试验订单复制到 Production。
