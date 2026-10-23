> **历史阶段记录，禁止照其中旧测试开关/恢复Mock或占位Production命令直接执行。当前唯一发布清单为 [launch-preparation-2026-10-22.md](launch-preparation-2026-10-22.md)。**

# Production执行清单（尚未执行）

## 需要填入并独立核验的真实配置

- 正式WEB_ORIGIN/API_ORIGIN（HTTPS根地址），与商户申报/通知域名、Turnstile widget和Pages域名一致。
- Production Worker/Pages项目名及真实D1 UUID；当前源码Production UUID和域名仍为占位值。
- Chrome商店条目ID与Package页公开公钥，EXTENSION_ORIGIN=chrome-extension://该ID；正式构建只指向Production API。
- AUTH_HASH_SECRET、PASSWORD_PEPPER、MAIL_API_KEY、MAIL_FROM、TURNSTILE_SECRET_KEY、DEEPSEEK_API_KEY、XIAODOU_EPAY_GATEWAY、XIAODOU_EPAY_PID、XIAODOU_EPAY_KEY，均单独写入Production，不导出Staging Secret。
- PAYMENT_PROVIDER=xiaodou_epay；真实模型模式、保守费率、D1应用日美元预算、站点上限及邮件/注册限流。旧默认Production未配置费率且provider仍RSA2，不能原样部署。
- Production唯一管理员使用正式注册并验邮的账号稳定user ID单独绑定；不迁移Staging管理员/用户/余额/订单。
- 经营者身份、客服与隐私联系邮箱、隐私政策/条款最终审核、支付通知重发或平台人工核验渠道。

## 获得Production发布授权后才执行

1. 保存真实配置审查记录，check:production通过；确认账号/资源归属，备份已有正式库（若有）。
2. 创建隔离D1并核实UUID，空库按0001–0012顺序执行迁移且每次只登记一次，运行只读一致性审计。不复制Staging业务数据。
3. 安全录入上述Secrets；购买环境许可0、DB purchase_enabled0；真实AI预算在库中明确限定。保持GET回调query脱敏和Invocation Logs关闭。
4. Worker先部署，确认100%版本、健康、CORS、D1、Secret名称和无效签名拒绝；配置正式回调 `<API_ORIGIN>/v1/payments/xiaodou/epay/notify`。
5. 构建匹配API合同的Pages并发布；正式回跳由服务端生成 `<WEB_ORIGIN>/account/?payment_order=<id>`，不能以回跳判成功。
6. 创建正式账号验邮、绑定唯一管理员；验证普通用户无法管理，Staging测试开关/邮箱不进入正式配置。
7. 商店草稿ID固定后重新构建正式ZIP；真实X验收、隐私披露、审核材料通过。先未发布/受限发布，由本人决定公开。
8. 本人批准一次正式小额支付后才开放新购买；验签事件、金额与唯一批次/流水对照，确认自动余额刷新。Codex不代付。
9. 异常立即关闭新购买或AI入口，保留Webhook/旧订单读取/Secrets；记录活动版本并恢复兼容版本，不删除订单或回滚财务数据。

本轮只准备此清单，没有执行任何Production变更。不要直接复制带占位值的命令运行。

## 已获正式环境授权、配置核实后使用的命令顺序

以下本轮**没有运行**。先把真实UUID、域名、商店ID及正确provider/成本配置写入Production环境，确保命名绑定指向独立正式库，再逐条执行，任一步异常停止：

```sh
cd '/Users/xuyaoyang/x posst/apps/reply-copilot/api'
npm run check:production
npx --no-install wrangler whoami
npx --no-install wrangler d1 migrations list DB --env production --remote
# 已存在正式数据则先用独立、不覆盖的0600文件路径导出备份并恢复校验。
# 空库或经审查的待迁移列表核对无误后：
npx --no-install wrangler d1 migrations apply DB --env production --remote
npx --no-install wrangler secret list --env production
npx --no-install wrangler deploy --env production --dry-run
npx --no-install wrangler deploy --env production
npx --no-install wrangler deployments list --env production
```

这里`DB`有明确`--env production`，但命令安全性最终依赖已经独立核实过的Production UUID，不能在占位配置上执行。不要将Secret值作为命令参数；使用`wrangler secret put <名称> --env production`本机交互录入。Pages先用最终PUBLIC_API_BASE_URL和正式Turnstile sitekey构建，再对已创建核实的正式项目发布；正式Pages项目名/分支未确认前不提供假定项目的可执行部署命令。
