import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const channel = process.argv[2];
if (!["development", "production"].includes(channel)) throw new Error("Use development or production");
const output = path.join(root, "dist", channel);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of ["background", "config", "content", "domain", "icons", "onboarding", "options", "prompts", "services", "sidepanel", "utils", "manifest.json", "privacy.html"]) cpSync(path.join(root, name), path.join(output, name), { recursive: true });
if (channel === "production") {
  const websiteUrl = process.env.REPLY_COPILOT_WEBSITE_URL || "";
  const hostedApiUrl = process.env.REPLY_COPILOT_API_URL || "";
  for (const value of [websiteUrl, hostedApiUrl]) if (value && (new URL(value).protocol !== "https:" || new URL(value).pathname !== "/")) throw new Error("Production URLs must be HTTPS origins");
  const configPath = path.join(output, "config", "runtime.js");
  writeFileSync(configPath, `export const RUNTIME_CONFIG = Object.freeze({ channel: "production", websiteUrl: ${JSON.stringify(websiteUrl)}, hostedApiUrl: ${JSON.stringify(hostedApiUrl)}, requestTimeoutMs: 30000 });\n`);
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = manifest.host_permissions.filter((origin) => origin !== "http://127.0.0.1:8787/*");
  if (hostedApiUrl) manifest.host_permissions.push(`${new URL(hostedApiUrl).origin}/*`);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(output, "config", "dev-state.js"), 'export async function readDevMock() { throw new Error("开发模拟状态在正式版中不可用。"); }\nexport async function writeDevMock() { throw new Error("开发模拟状态在正式版中不可用。"); }\n');
  const router = readFileSync(path.join(output, "services", "ai-provider-router.js"), "utf8");
  if (!router.includes('this.config.channel === "development"')) throw new Error("Production router guard missing");
  const optionsPath = path.join(output, "options", "options.html");
  const options = readFileSync(optionsPath, "utf8");
  const cleanedOptions = options.replace(/<div id="dev-mock-box"[\s\S]*?<\/select><\/label><\/div>/, "");
  if (cleanedOptions === options) throw new Error("Developer mock UI was not removed");
  writeFileSync(optionsPath, cleanedOptions);
  const welcomePath = path.join(output, "onboarding", "onboarding.html");
  writeFileSync(welcomePath, readFileSync(welcomePath, "utf8").replace(/<button id="dev-setup"[^>]*>[\s\S]*?<\/button>/, ""));
  if (existsSync(path.join(output, "dev"))) throw new Error("Development files entered production package");
}
console.log(`Built ${channel} extension: ${output}`);
