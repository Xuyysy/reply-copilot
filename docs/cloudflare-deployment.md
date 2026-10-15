# Cloudflare 上线准备（尚未部署）

本文件是将本地内测版转为线上版的检查清单，不是自动部署脚本。当前 `api/wrangler.jsonc` 的 D1 UUID 是本地占位值，`WEB_ORIGIN` / `API_ORIGIN` 指向本机，生产邮箱凭据未配置。直接部署无法提供正常的公开注册服务。

## 需要先完成

1. 在 Cloudflare 账户创建正式 D1，替换 `api/wrangler.jsonc` 中的 `database_id`；考虑另建预发布库。
2. 选定官网与 API 的 HTTPS 地址，建议同一主域下的 `www` 与 `api` 子域，使 `SameSite=Lax` Cookie 可按设计工作。把 `WEB_ORIGIN`、`API_ORIGIN` 改为精确源；设置正式 `EXTENSION_ORIGIN` 为实际 Chrome 扩展 ID。审查 CORS 与 Cookie 配置。
3. 当前预留 Resend 邮件适配器。经批准后配置 `MAIL_API_KEY` Worker Secret 与已验证域名的 `MAIL_FROM`，并核查发信额度和成本。缺少配置时返回 `MAIL_NOT_CONFIGURED`，生产环境不会打印验证码。
4. 在 Worker Secret 中配置 `AUTH_HASH_SECRET`、`DEEPSEEK_API_KEY` 和邮件服务的 `MAIL_API_KEY`。不能提交到 Git、Pages 构建变量、浏览器代码或普通 Wrangler `vars`。`AI_MOCK` 仅可保留在本地 `.dev.vars`；线上 `ENVIRONMENT` 必须为 `production`。
5. 将 `SITE_DAILY_CAP` 设为符合真实预算的上限。检查 DeepSeek 账户余额与成本告警。
6. Pages 项目根目录设为 `web`，构建命令 `npm run build`，输出目录 `dist`，并设置 `PUBLIC_API_BASE_URL` 为正式 API HTTPS 源。正式官网法律页面、运营主体、联系方式与退款条款需经营者审核。
7. 用 `REPLY_COPILOT_WEBSITE_URL` 和 `REPLY_COPILOT_API_URL` 构建生产插件，确认生成包里没有 localhost 权限和开发模拟入口。检查 `debugger` 权限及 X 平台要求，再决定上架方式。
8. 在预发布环境先测试真实邮件、设备绑定、Cookie、CSRF、配额重置和调用成本；再考虑正式域名和发布。

Cloudflare 官方文档说明 D1 迁移可用 Wrangler 执行，Astro 静态站点可在 Pages 使用 `npm run build` / `dist`。Wrangler 的 `secret put` 可能立即创建并部署 Worker 新版本；实际运行任何远端命令前应先审查配置和获得部署授权。

- D1 命令：https://developers.cloudflare.com/workers/wrangler/commands/d1/
- Astro Pages：https://developers.cloudflare.com/pages/framework-guides/deploy-an-astro-site/
- Worker Secrets：https://developers.cloudflare.com/workers/configuration/secrets/

## 下一阶段支付

先选定合法的收款主体、地区和支付渠道，再设计订单表、支付请求、服务端回调验签、幂等发证、退款及撤销流程。只有支付服务端确认到账后才能写入 `licenses`。本阶段 `license:local` 命令仅操作本地数据库，不是购买入口。
