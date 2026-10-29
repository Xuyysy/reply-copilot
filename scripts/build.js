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
const stagingDomInputExperiment = channel === "staging" && process.env.REPLY_COPILOT_STAGING_NO_DEBUGGER === "1";
const websiteUrl = packagedChannel ? productionOrigin("REPLY_COPILOT_WEBSITE_URL") : "";
const hostedApiUrl = packagedChannel ? productionOrigin("REPLY_COPILOT_API_URL") : "";
if (packagedChannel && websiteUrl === hostedApiUrl) throw new Error("Website and API origins must be distinct");
const output = path.join(root, "dist", channel);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const name of ["background", "config", "content", "domain", "icons", "onboarding", "options", "prompts", "services", "sidepanel", "utils", "manifest.json", "privacy.html"]) cpSync(path.join(root, name), path.join(output, name), { recursive: true });
if (stagingDomInputExperiment) {
  cpSync(path.join(root,"experiments/staging-no-debugger/services/delivery-coordinator.js"),path.join(output,"services/staging-delivery-coordinator.js"));
  for (const name of ["background/service-worker.js", "content/content-script.js", "content/post-extractor.js", "content/composer-adapter.js", "content/composer-association.js"]) cpSync(path.join(root, "experiments/staging-no-debugger", name), path.join(output, name));
  writeFileSync(path.join(output,"content/experiment-config.js"),`globalThis.ZaneReplyCopilotContent ||= {};\nglobalThis.ZaneReplyCopilotContent.experimentConfig=Object.freeze({associationOnly:${process.env.REPLY_COPILOT_STAGING_INPUT_VALIDATION !== "1"}});\n`);
  rmSync(path.join(output, "services/native-input-service.js"));
}
if (packagedChannel) {
  const configPath = path.join(output, "config", "runtime.js");
  writeFileSync(configPath, `export const RUNTIME_CONFIG = Object.freeze({ channel: ${JSON.stringify(channel)}, websiteUrl: ${JSON.stringify(websiteUrl)}, hostedApiUrl: ${JSON.stringify(hostedApiUrl)}, allowedHttpHosts: [], requestTimeoutMs: 30000 });\n`);
  const manifestPath = path.join(output, "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (stagingDomInputExperiment) {
    manifest.permissions = manifest.permissions.filter(permission => permission !== "debugger");
    const files=manifest.content_scripts[0].js;
    files.splice(files.indexOf("content/content-script.js"),0,"content/experiment-config.js","content/composer-association.js");
  }
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
