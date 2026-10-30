# Staging 性能候选部署与人工采样交接（2026-10-30）

## 当前状态

已部署 Staging Worker，已准备原路径测试扩展，**真实 X 性能采样尚未执行**。本轮真实模型调用为 0；不将本地 mock 的延迟或测试通过数当作真实浏览器验收。Production、Pages、商店插件、D1 数据均未修改。

- 功能源码：`codex/generation-to-composer-performance@e64bf2cf493c8a5e235665d798afc2116b6e0a91`。
- 新 Worker version：`5cb80ae9-3b02-4d8a-9048-1d539c907595`。
- 新 deployment：`e6c42694-62c7-47e2-a78d-6fb6362dd2c6`，100% 流量。
- 旧 version：`3d24918f-e2bf-4a9e-8de8-a80e5114e23d`。
- 旧 deployment：`076ec210-0b38-478a-b249-0bf37ef9c15b`。
- Worker：`reply-copilot-api-staging`；D1：`reply-copilot-staging` / `cd44bb44-b525-42c4-b286-2cc84dae7fdb`。

后续文档提交不改变上述已部署功能源码，不应将文档提交 SHA 误写成部署源码 SHA。

## 旧部署的来源核查

下载旧 Worker 模块及 source map，在受控环境中仅比较源码与摘要。41 个 source-map 来源均与 `codex/admin-ai-model-management@34730a93` 一致；重新构建该提交的 index.js 与线上模块字节完全一致。因此，没有发现需要额外保留的未提交应用代码。

- 旧 index.js：404262 bytes，SHA-256 `a5636c97bec29759ff3a04568e77e7d0c901e19bb976209ac94de515cde4ede8`。
- 新 index.js：410424 bytes，SHA-256 `adc144e27ac9d367ab77992d3fe956e7db2b31ec940797f6d6b13e4bf51f4beb`。
- 新模块从线上重新读取，摘要与本地候选构建完全一致。

现行运行参数通过版本上传的 `--keep-vars` 保留；上传后先比较全部绑定，再切换 100% 流量。原 41 个绑定（其中 25 个 Secret 名称）、兼容性配置、域名、定时任务及观测配置全部保留。未读取或导出 Secret 值。唯一新增变量为 `AI_PERFORMANCE_DIAGNOSTICS=1`。

## 本轮重新执行的验证

| 检查 | 结果 |
|---|---|
| 完整 npm test（包括 Staging Web 构建） | 698/698，0 失败、0 跳过 |
| API TypeScript | 通过 |
| Web TypeScript | 通过 |
| Staging Worker versions upload dry-run | 通过 |
| Staging 插件构建及最终文件审计 | 通过；0.3.2，无 debugger 权限/API |
| GET /health | 200，ok=true |
| GET /v1/packages | 200，paymentAvailable=true |
| 价格与支付方式 | 1043 / 2095 / 3464 分；MK99 ALIPAY_H5、WECHAT_H5 |
| 未登录 GET /v1/me、/v1/admin/dashboard | 均 401 AUTH_REQUIRED |
| 原扩展 Origin 的 CORS | 返回原 Staging extension Origin |
| 真实 X 编辑器、模型调用、端到端 P50/P90 | 待用户采样，不声称通过 |

本机受限网络曾出现 DNS/TLS 连接错误；获得公网访问权限后，同一 Staging 域名健康、套餐与鉴权检查通过。没有修改本机 DNS/VPN 或应用安全校验。

回归覆盖 ACK 幂等、结果重放、唯一扣费、取消与迟到响应、旧客户端 JSON、草稿保护、关联保护及 DNS 私有地址/CNAME/超时等。测试通过不能证明真实网络与 X DOM 的表现。

## 业务开关与 D1 前后对照

| 项目 | 部署前 | 部署后 |
|---|---|---|
| AI_MODE / ai_enabled | production / 1 | production / 1 |
| PAYMENTS_ENABLED / purchase_enabled | 1 / 1 | 1 / 1 |
| ADMIN_PORTAL_ENABLED | 1 | 1 |
| active_merchant / payment_mk99_enabled | mk99 / 1 | mk99 / 1 |
| 支付宝 enabled / released | 1 / 1 | 1 / 1 |
| 微信 enabled / released | 1 / 1 | 1 / 1 |
| 当前模型 | Qwen qwen3.7-flash v1 | 相同 |
| 每日总成本上限 | 5000000 micro-USD | 相同 |
| free / paid generation reserved | 0 / 0 | 0 / 0 |
| 负余额账户 / 重复 generation_debit 组 | 0 / 0 | 0 / 0 |
| 请求数 / consumed / reserved | 413 / 408 / 0 | 413 / 408 / 0 |
| 当日 settled / reserved cost | 3480 / 0 micro-USD | 相同 |

仅执行 SELECT 核验，无迁移、人工额度调整、订单动作或真实生成。支付回调代码没有变化；未伪造通知或再次付款验证。

## 插件身份、安装及回滚

Chrome 的既有解压加载记录指向用户原安装目录 `apps/reply-copilot/dist/staging`。该安装没有 manifest RSA 公钥；Chrome 身份来自**原绝对加载路径**。对该绝对路径按 Chromium 路径 ID 规则计算，得到 `kaaehkpihjenlhjjfjcopkjhegmfmchk`。不能新增公钥或改用临时目录声称保留身份。

原目录 48 个文件完整备份，并逐文件 SHA-256 验证；46 个非环境/manifest 文件与 34730a93 构建来源一致。候选 49 个文件已安全替换回同一绝对路径，复制前再次验证原目录未变，复制后逐文件比对候选。没有卸载、清空 storage 或操作浏览器。

- manifest：0.3.2；permissions：contextMenus、storage、sidePanel、clipboardWrite。
- API：`https://api-staging.x-reply-helper.top`。
- 网站：`https://staging.x-reply-helper.top`。
- 原路径：`/Users/xuyaoyang/x posst/apps/reply-copilot/dist/staging`。
- 私有备份与两份回滚脚本：`/Users/xuyaoyang/x posst/.reply-copilot-private-backups/staging-performance-20261030/`。其中仅有 Secret 名称与配置摘要，不含导出的 Secret 值。

**磁盘候选已准备，Chrome 尚未重新加载，不能据此声称运行中的插件已更新。** 用户在 chrome://extensions 对原 ID 点击重新加载，然后刷新 X；不要卸载、重装或加载临时目录。

## 首轮真人采样（最多 8 次真实生成）

沿用正常绑定的 Staging 账户，不改变模型和预算；首轮最多 8 次，无自动付费重试，不发送评论、不付款。建议中英文、长短帖各 2 条。若出现鉴权、额度、ACK 或草稿错误，停止并保留现场；不能为了凑样本反复生成。

1. 在 chrome://extensions 打开原 Staging 插件的 Service Worker 检查窗口，仅在该受信控制台执行：

```js
await chrome.storage.session.set({generationPerformanceEnabled:true});
clearReplyCopilotPerformance();
```

2. 在 X 通过原生回复按钮逐条生成草稿，观察三条候选、切换、可编辑/撤销；不要点击发布。不要清理已有用户草稿，另选空白回复框验证。可单独观察已有草稿不覆盖及取消，但不要额外重复调用模型。
3. 完成后及时执行并复制匿名报告：

```js
JSON.stringify(replyCopilotPerformanceReport(), null, 2)
```

4. 回复测试起止时间、实际调用次数、是否有失败/取消/重试，以及报告。无需提供账号、帖子正文、回复、Token、Cookie 或请求 ID。
5. 采样结束可关闭客户端开关，不会关闭 AI：

```js
await chrome.storage.session.set({generationPerformanceEnabled:false});
```

报告只保留内存中的固定阶段、数值时长与结果计数，不持久化正文、用户标识或请求 ID。内容脚本和 Worker 的时钟不同，只合并持续时间。Service Worker 终止会清空聚合；保持其 DevTools 打开会改变空闲生命周期，因此这轮不是休眠恢复性能验收。`editor_verified` 为点击至实际编辑内容核验；model 包含上游网络与解析，不能当作纯推理时间。最多 8 个样本只报告描述性 P50/P90；即使工具输出 p95，也不能据此宣称稳定 P95 或真实提速比例。

人工采样完成后再读取 D1：核对本次请求消费、独立 generation_debit、delivery ACK、成本与预占释放。当前的“0 重复扣次”只是部署后基线，**不代表本次真实 ACK 重试已验收**。如果还有其他账户并发使用，应按测试时间窗与合法账户归属核对，不能仅用全站聚合差额作证明。

## Worker 回滚

已保存可执行回滚脚本 `rollback-worker.command`，恢复上面的旧版本 100% 流量。等价命令：

```sh
./api/node_modules/.bin/wrangler versions deploy 3d24918f-e2bf-4a9e-8de8-a80e5114e23d@100 \
  --name reply-copilot-api-staging --config api/wrangler.jsonc --env staging --yes
```

插件执行 `rollback-extension.command` 后，在原扩展卡片重新加载并刷新 X。脚本保留替换前后的目录，不改变原路径、ID 或 storage。代码回滚不恢复 D1；本次没有数据库迁移，不应恢复数据库覆盖正常业务。

停止/回滚条件：绑定或运行开关异常、健康/鉴权出现应用回归、跨帖/覆盖草稿、重复扣次、ACK/预算一致性异常。无异常时保持现有 AI、购买与回调开放。真实验收前不建议自动推广到 Production。
