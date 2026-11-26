import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { extensionIdentity } from "./extension-identity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const channel = process.argv[2];
if (!["development", "staging", "production"].includes(channel)) throw new Error("Use development, staging or production");
function productionOrigin(name) {
  const value = process.env[name];
  let url;
  try { url = new URL(value); } catch { throw new Error(`Production URLs must be configured HTTPS origins: ${name}`); }
  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (url.protocol !== "https:" || value !== url.origin || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".invalid") || /^127\./.test(host) || /^\[(?:::1|::ffff:127\.[^\]]+)\]$/.test(host)) throw new Error(`Production URLs must be configured HTTPS origins: ${name}`);
  return url.origin;
}
const packagedChannel = channel === "staging" || channel === "production";
const websiteUrl = packagedChannel ? productionOrigin("REPLY_COPILOT_WEBSITE_URL") : "";
const hostedApiUrl = packagedChannel ? productionOrigin("REPLY_COPILOT_API_URL") : "";
if (packagedChannel && websiteUrl === hostedApiUrl) throw new Error("Website and API origins must be distinct");
const output = path.join(root, "dist", channel);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of ["background", "config", "content", "domain", "icons", "onboarding", "options", "prompts", "services", "sidepanel", "utils", "manifest.json", "privacy.html"]) cpSync(path.join(root, name), path.join(output, name), { recursive: true });
if (channel === "staging") cpSync(path.join(root, "staging"), path.join(output, "staging"), {recursive:true});
if (packagedChannel) {
  const configPath = path.join(output, "config", "runtime.js");
  writeFileSync(configPath, `export const RUNTIME_CONFIG = Object.freeze({ channel: ${JSON.stringify(channel)}, websiteUrl: ${JSON.stringify(websiteUrl)}, hostedApiUrl: ${JSON.stringify(hostedApiUrl)}, allowedHttpHosts: [], requestTimeoutMs: 30000 });\n`);
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Production must retain the existing store identity, including across clean builds.
  const stored = channel === "production" ? JSON.parse(readFileSync(path.join(root,"config/extension-store-identity.json"),"utf8")) : null;
  const publicKeyFile = process.env.REPLY_COPILOT_EXTENSION_PUBLIC_KEY_FILE;
  const expectedId = process.env.REPLY_COPILOT_EXTENSION_ID;
  if (stored && expectedId && expectedId !== stored.id) throw new Error("Production extension ID cannot differ from the existing Web Store item");
  if (stored || publicKeyFile) {
    const identity = extensionIdentity(publicKeyFile ? readFileSync(publicKeyFile,"utf8") : stored.publicKey, stored?.id || expectedId);
    manifest.key = identity.key;
    console.log(`Stable extension ID: ${identity.id}`);
  } else if (expectedId) {
    throw new Error("An expected extension ID requires its Web Store public key file");
  }
  if (channel === "staging") {
    manifest.background.service_worker = "staging/service-worker.js";
    manifest.content_scripts[0].js.unshift("staging/momentum-content.js");
    cpSync(path.join(root,"interaction-manager"),path.join(output,"interaction-manager"),{recursive:true});
    cpSync(path.join(root,"follow-manager"),path.join(output,"follow-manager"),{recursive:true});
    // Explicit, inspected-tab DevTools QA panel only; no background capture.
    manifest.devtools_page = "follow-manager/v2/devtools.html";
    // Isolated interaction pilot: no Production/development changes or new permissions.
    manifest.content_scripts[0].js.push("staging/interaction-capture.js");
    const panelPath=path.join(output,"sidepanel","sidepanel.html");
    const panel=readFileSync(panelPath,"utf8");
    const marker='<details class="dashboard-card quick-settings"';
    if(!panel.includes(marker))throw new Error("Staging interaction panel anchor changed");
    const interaction='<details class="dashboard-card" id="staging-interactions"><summary>账号运营工具（实验）</summary><p><a id="joint-follow-preview" href="../follow-manager/v2/workbench.html" target="_blank" rel="noopener noreferrer">互关助手 V2（模拟数据预览）</a></p><p class="muted-note">互关同步仍为模拟；经授权的开发验收可在 X 标签页 DevTools 打开「互关接口诊断」，读取一份真实响应。</p><p><a href="../interaction-manager/ui/index.html" target="_blank" rel="noopener noreferrer">打开离线互动分析工作台</a></p><p class="muted-note">打开 X 通知页，单次读取或开始连续读取，再手动滚动。连续读取最多90秒，只读取已加载页面，不发网络请求。按用户名临时观察，不验证稳定账号 ID，不保存历史。</p><div class="dashboard-actions"><button id="interaction-read" class="button" type="button">读取当前通知</button><button id="interaction-start" class="button secondary" type="button">开始连续读取</button><button id="interaction-stop" class="button secondary" type="button" disabled>停止</button><button id="interaction-clear" class="button secondary" type="button">清除会话</button></div><label class="setting-row">排行榜<select id="interaction-mode"><option value="confirmed">累计可去重记录</option><option value="snapshot">本次观察</option></select></label><label class="setting-row">类型<select id="interaction-type"><option value="all">全部</option><option value="reply">回复</option><option value="like">点赞</option><option value="repost">转发</option></select></label><label class="setting-row">搜索用户名<input id="interaction-search" type="search" maxlength="16"></label><p class="muted-note" id="interaction-status" role="status">尚未读取。</p><ol id="interaction-results"></ol><div id="interaction-details"></div></details>';
    writeFileSync(panelPath,panel.replace(marker,interaction+marker).replace("</body>",'<script type="module" src="../staging/interaction-panel.js"></script></body>'));

  }
  const bindingOrigin = channel === "production" ? "https://app.x-reply-helper.top" : "https://staging.x-reply-helper.top";
  if (websiteUrl === bindingOrigin) manifest.externally_connectable = {matches:[`${bindingOrigin}/*`]};
  manifest.host_permissions = [`${hostedApiUrl}/*`];
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (existsSync(path.join(output, "dev")) || existsSync(path.join(output, "config", "dev-state.js")) || existsSync(path.join(output, "services", "deepseek-client.js"))) throw new Error("Development-only files entered hosted package");
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(file);
      else if (/\.(?:html|js|json|css)$/.test(entry.name) && /http:\/\/(?:127\.0\.0\.1|localhost)|api\.deepseek\.com|dev-mock-box|dev-setup|data-panel="ai"|byokFactory|testDeepSeekConnection/.test(readFileSync(file, "utf8"))) throw new Error(`Hosted artifact contains a development or direct-provider path: ${path.relative(output, file)}`);
    }
  }
  scan(output);
}
console.log(`Built ${channel} extension: ${output}`);
