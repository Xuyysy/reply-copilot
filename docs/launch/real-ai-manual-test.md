> 已过时：当前规则见 ../operations/staging-business-mode.md。不要再执行旧real-test或恢复Mock步骤。

# 本次管理员真实AI验收

已从唯一管理员稳定ID解析其已验邮账号，在不显示邮箱的情况下更新Staging REAL_DEEPSEEK_TEST_USER_EMAIL Secret。未读取/更换DEEPSEEK_API_KEY。

临时完整配置 `/private/tmp/xrh-real-ai-active.json`：Staging real-test，REAL_DEEPSEEK_TEST_ENABLED=1，PAYMENTS_ENABLED=0，Webhook1，管理员后台1，SITE_DAILY_CAP10，应用日预算50000微美元；D1预算也已只读核实50000。Production环境未包含在该临时配置中。本地仓库默认仍mock/测试0。

1. 按dist/release/INSTALL-STAGING.md重载准确目录的插件与X页面。
2. 登录当前管理员账户并绑定插件；关闭自动生成建议。其他邮箱被real-test策略拒绝，不会降级为Mock冒充真实AI。
3. 对一条不含敏感内容的帖子手动生成一次，记录大致秒数；查看三条候选，切换风格、编辑并插入（无需发布）。每次三条只扣1。
4. 如需中英文/不同风格各测一次，最多做必要的少量手动生成；每次都是真实模型费用/次数，不因想比较而循环重试。上游25秒截止，客户端30秒；失败提示不代表自动扣1，交付未确认应重试同一个请求。
5. 回复结果文字本身不是“真实模型证明”。完成后提供生成requestId（非Token），由只读ai_usage_costs核对model、input/output tokens、estimated_cost及请求/交付/唯一消费流水，确认不是mock。不能只凭浏览器截图判定扣费或支付。
6. 反馈结果后立即用 `/private/tmp/xrh-real-ai-restore.json` 部署恢复mock/测试0，购买保持关闭；不要用不完整--var覆盖其他配置。此恢复文件保留原业务D1、全部完整非敏感变量及16项Secrets绑定。恢复后/health200且packages paymentAvailable=false。

当前购买运营DB开关仍为1，但临时环境许可0使新购买不可用；未改订单或管理员运营值。完成验收后是否恢复环境购买许可1应由经营者决定，不把恢复Mock等同于恢复收款。

Codex没有代为生成、付款、退款或查询支付平台。启用real-test不证明DeepSeek余额有效；如果余额不足，停止并由本人在官方后台处理，不能自动充值或无限重试。

本次临时活动Worker版本：`d29993aa-21fc-4947-9169-8eaa31c687c1`，远端确认100%流量。Pages不变：`95b78763-ab0e-4030-9836-9478bdcf1887`。健康200、套餐200且paymentAvailable=false；16项Secret名称仍齐全。不要使用仓库mock默认配置来解释该临时活动版本。
