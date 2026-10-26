import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveStagingApiBase } from './staging-build-config.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = resolveStagingApiBase(process.env.PUBLIC_API_BASE_URL);
const result = spawnSync('npm', ['run', 'build'], {
  cwd: webRoot,
  env: { ...process.env, PUBLIC_API_BASE_URL: apiBase },
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

const bundles = await Promise.all((await findJavaScriptFiles(path.join(webRoot, 'dist'))).map(file => readFile(file, 'utf8')));
if (!bundles.some(bundle => bundle.includes(apiBase))) {
  throw new Error('Staging build verification failed: PUBLIC_API_BASE_URL was not found in generated JavaScript.');
}

console.log(`Verified Staging API origin in generated JavaScript: ${apiBase}`);
