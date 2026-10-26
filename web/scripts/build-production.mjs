import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveProductionApiBase, resolveProductionTurnstileSiteKey } from './production-build-config.mjs';
import { cleanProductionOutput } from './clean-production-output.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = resolveProductionApiBase(process.env.PUBLIC_API_BASE_URL);
const turnstileSiteKey = resolveProductionTurnstileSiteKey(process.env.PUBLIC_TURNSTILE_SITE_KEY);
cleanProductionOutput(path.join(webRoot,'dist'));
const result = spawnSync('npm', ['run', 'build'], {
  cwd: webRoot,
  env: { ...process.env, PUBLIC_API_BASE_URL: apiBase, PUBLIC_TURNSTILE_SITE_KEY: turnstileSiteKey },
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

async function findJavaScriptFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findJavaScriptFiles(filePath));
    else if (entry.isFile() && filePath.endsWith('.js')) files.push(filePath);
  }
  return files;
}

async function findHtmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findHtmlFiles(filePath));
    else if (entry.isFile() && filePath.endsWith('.html')) files.push(filePath);
  }
  return files;
}

const bundles = await Promise.all((await findJavaScriptFiles(path.join(webRoot, 'dist'))).map(file => readFile(file, 'utf8')));
const pages = await Promise.all((await findHtmlFiles(path.join(webRoot, 'dist'))).map(file => readFile(file, 'utf8')));
if (!bundles.some(bundle => bundle.includes(apiBase)) || !pages.some(page => page.includes(turnstileSiteKey)) || bundles.some(bundle => bundle.includes('api-staging.x-reply-helper.top'))) {
  throw new Error('Production build verification failed: generated JavaScript must contain the verified Production API origin and Turnstile Site Key only.');
}

console.log(`Verified Production API origin in generated JavaScript: ${apiBase}`);
