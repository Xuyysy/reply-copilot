> **历史阶段记录，禁止照其中旧测试开关/恢复Mock或占位Production命令直接执行。当前唯一发布清单为 [launch-preparation-2026-10-22.md](launch-preparation-2026-10-22.md)。**

> 已过时：当前规则见 ../operations/staging-business-mode.md。不要再执行旧real-test或恢复Mock步骤。

# 最终Staging人工验收交接（2026-10-22）

- 397项：上一轮上线准备；400项：增加支付宝展示/后台文案测试后；当前重新执行400/400通过。都基于dirty工作区，不是HEAD单独的测试结论。
- HEAD65e243db89456d10e93e63d8dc301e1b7bf4068d，分支codex/v0.4-credits，ahead14；没有提交或推送。dist/release/source-sha256.json保存交付源码文件摘要，release-manifest.json保存ZIP及配置摘要。
- 原活动Worker34addcf9-550f-4fd5-bffa-56ee0b94896c/Pages95b78763-ab0e-4030-9836-9478bdcf1887已远端核实。
- 当前临时real-test Worker d29993aa-21fc-4947-9169-8eaa31c687c1，100%流量；Pages不变。管理员真实AI测试邮箱Secret已安全更新，未更换模型Key或任何支付Key。
- 当前环境购买许可0（所以paymentAvailable=false），数据库purchase_enabled1未改；Webhook1、后台1、real-test1、站点10、应用/D1日预算50000微美元。仓库默认仍mock/测试0，与临时运行配置有意区分。恢复文件为/private/tmp/xrh-real-ai-restore.json，恢复mock时购买仍关闭。
- 16项Secret存在、D1UUID不变；健康和套餐200。没有主动请求模型或支付平台，没有创建支付/退款。
- 最新摘要：订单3、事件1、账本22、免费总额398/付费400；比旧400/400基线新增2次Mock成功交付，各有唯一扣次（总free_delta=-2、paid_delta0），Token/模型成本0；不是部署补账。四项财务一致性审计均0异常。
- 今天站点已用2/10，真实模型日成本/预留均0。实际模型余额和最新X DOM/质量/速度仍需本人验收，不能用Mock通过代替。
- 插件dist/staging真实Chrome加载ID匹配kaaehkpihjenlhjjfjcopkjhegmfmchk；ZIP完整性通过、45文件，仅Staging/未发布商店草稿用途。尚未拿到商店公钥/条目ID，不能声称正式包固定ID。
- 官方易支付文档证实未获success会自动重投最多8次；未证实后台手动重发按钮。漏通知需按运营工单核实并请求官方原通知重投，不凭截图或普通赠额替代支付账本。

下一步：本人按安装指南重载插件和X页面，关闭自动建议，以管理员账号手动生成；反馈requestId后只读核对真实模型/Token/成本/扣次并恢复Mock。商店只创建未发布草稿，获取条目ID+公开公钥，正式API/隐私资料就绪后再构建Production包。Production发布另行授权。
