# Chrome Web Store 身份已固定（2026-10-23）

- 商店现有Item ID：`fgfjajofkapebgphfidblngcjomkbdaj`。
- 用户提供的RSA SPKI公开公钥已推导校验，与该ID完全一致。没有生成新密钥或新商店条目。
- 公开元数据：`config/extension-store-identity.json`。Production构建默认使用它，不再依赖临时Shell变量；任何试图覆盖成不同ID/公钥的Production构建均拒绝。
- `scripts/store-release.mjs --production`生成 `dist/release/reply-copilot-production-0.3.0.zip` 和 `production-package-audit.json`。包为正式身份候选，仍需正式后端部署后才可公开；没有自动上传/提交审核/发布。
- Production插件连接 `https://app.x-reply-helper.top`、`https://api.x-reply-helper.top`，不连接Staging。Production两个本地配置EXTENSION_ORIGIN都已同步；发布使用已准备的 `api/deploy/production.wrangler.json`，其D1 UUID仍需填真实值，不能部署带占位值的默认环境。
- Staging源码manifest不写商店key，继续当前路径加载的独立ID `kaaehkpihjenlhjjfjcopkjhegmfmchk`，Staging Worker扩展来源不变。商店ID插件不应借用Staging授权Token、登录会话或余额。

## 登录与来源校验

网站登录仍只允许各自WEB_ORIGIN；扩展设备码申请/轮询要求精确EXTENSION_ORIGIN，随后由对应网站登录用户批准绑定。Production仅允许商店ID；Staging仅允许原测试ID；不增加通配、缺省Origin或跨环境例外。

本地测试使用实际security.ts、http.ts、device.ts验证：商店origin通过来源门；Staging/伪造后缀/网站origin/null不能请求Production设备码；网站登录不接受扩展origin；CORS预检正常origin204、跨环境403，响应不向错误来源发放CORS头。测试不申请真实设备码、不访问远端，不冒充Production实测。

## 仍需完成

1. 单独授权创建Production Worker/Pages/D1，核验真实UUID并迁移0001–0012，不导入Staging数据。
2. 最终确认app/api子域及DNS/TLS，保留根域/www已有服务；确认商店/后端Origin与本包地址一致。
3. 安全录入独立Production认证、邮件、Turnstile、DeepSeek、易支付Secrets；页面PUBLIC_API_BASE_URL及公开Turnstile sitekey匹配正式环境。
4. 本人正式注册/验邮后按稳定user ID初始化唯一管理员；保持购买0，后台运营预算明确设置。
5. 经营主体、公开隐私/客服及通知重发渠道确认；商店隐私披露、截图、宣传图、审核资料完成。
6. 正式后端上线后，使用本包进行设备绑定、真实X生成、交付扣次/CORS实测，再由本人决定更新现有商店条目并提交审核。后续若后台要求提升版本号，只升级version，不更换key/Item ID、不新建条目。

Production购买保持关闭。本轮不部署、不修改任何远端Secret或数据库、不提交推送Git。
