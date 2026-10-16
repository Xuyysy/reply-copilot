import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

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
if (packagedChannel) {
  const configPath = path.join(output, "config", "runtime.js");
  writeFileSync(configPath, `export const RUNTIME_CONFIG = Object.freeze({ channel: ${JSON.stringify(channel)}, websiteUrl: ${JSON.stringify(websiteUrl)}, hostedApiUrl: ${JSON.stringify(hostedApiUrl)}, allowedHttpHosts: [], requestTimeoutMs: 30000 });\n`);
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
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
