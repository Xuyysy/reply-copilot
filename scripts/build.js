import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const channel = process.argv[2];
if (!["development", "production"].includes(channel)) throw new Error("Use development or production");
const output = path.join(root, "dist", channel);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of ["background", "config", "content", "domain", "onboarding", "options", "prompts", "services", "sidepanel", "utils", "manifest.json", "privacy.html"]) cpSync(path.join(root, name), path.join(output, name), { recursive: true });
if (channel === "production") {
  const configPath = path.join(output, "config", "runtime.js");
  writeFileSync(configPath, `export const RUNTIME_CONFIG = Object.freeze({ channel: "production", websiteUrl: "", hostedApiUrl: "", requestTimeoutMs: 30000 });\n`);
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
