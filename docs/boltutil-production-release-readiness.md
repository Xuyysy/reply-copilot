# BoltUtil 五链支付：Production 发布准备与门禁

状态：**仅准备，不代表已在 Production 开启收款。** Staging 已完成独立五链收款入口验证。正式 Production 发布要区分 UI/代码上线与真实收款启用。

## 已完成的 Staging UI 改进
- 账户中心 USDT 额度包订单收在 **充值订单** 折叠区，USDT 订阅订单收在 **订阅订单** 折叠区；不再挂载页面底部独立充值面板。
- 套餐订阅的支付方式卡片和下一步引导包含 TRON、Polygon、BNB Smart Chain、Ethereum/ERC20、Solana/SPL USDT。
- 管理后台五链运行状态和真实订单/人工审核列表保留；过时的三链管理员实付测试面板移除。
- `BOLTUTIL_ADMIN_TEST_CREATE_ENABLED` 默认缺失（OFF），服务端禁止创建新的管理员测试单；老订单签名回调、审计读取和可信查单入口仍保持可用。**不得删除旧测试的 D1 行或事件证据。**

## 只允许经过审查的 Production 发布
1. **精确源码与测试**：先由 Pull Request 经全量测试、构建、静态安全分析，确认部署源码 SHA 和部署脚本严格一致；不把 Draft PR 未经审查直接合并。
2. **数据库**：Production D1 与 Staging D1 **绝不可混用**。当前未核查、未迁移 Production D1，不能宣称具备五链表结构。对 Production D1 的任何查询/迁移都需单独说明范围和备份/回滚措施，获明确授权才执行。
3. **密钥**：Production BoltUtil API Key 与 Webhook Secret 必须来自 **Production** 商户，不能继承 Staging 的真实收款地址、密钥、Webhook URL 或历史测试订单。
4. **钱包**：在 BoltUtil 商户控制台逐链确认 TRC20、Polygon、BEP20、ERC20、Solana USDT 钱包与 Token/Mint 实际可用；支持的网络不等于已绑定、启用、完成真实支付验收。
5. **汇率和定价**：Staging 固定 `BOLTUTIL_CNY_PER_USDT_MICROS=7000000`（¥7/USDT）仅为测试占位，**禁止当作 Production 正式汇率**。Production 上线前需明确批准报价、手续费、最大/最小支付、舍入与过期策略。
6. **渐进上线**：Production 首次部署应默认 `BOLTUTIL_ENABLED=0`、新建订单 OFF、各链单独 OFF；先验证 UI 不误露敏感密钥、网页仅依真实可用性显示网络，MK99/小豆人民币支付不中断。再分别申请开启每条网络；任何真实商户创建单和链上转账需要人工完成对应验收。
7. **金额与 Gas**：订单提供的准确 USDT 实际到账金额不可被网络费扣减或四舍五入。钱包分别支付 TRX/POL/BNB/ETH/SOL Gas；交易所提币以最终实际到账 USDT 为准。
8. **支付终态**：坚持 BoltUtil 可信查单、签名回调、金额/网络/收款地址匹配、幂等入账。绝不因页面倒计时结束或用户刷新就当作交易关闭；`EXPIRED` 仍可能有晚到资金。
9. **支付历史/回滚**：绝不迁移或删除已付款用户订单、测试订单及审计证据；回滚时先关掉新建订单，只能用批准的资金对账/恢复方案处理金融记录。
10. **Production 验证**：记录发布前后 Production Worker 与 Pages 版本、绑定数、CNY 通道状态；验证官方生产域名与所有结账流程无回归。上线前后禁止从网页或日志明文输出任何支付密钥。

当前范围：以上为预发布准备，未在 Production 新建订单、转账、修改 D1、切换开关或部署。
