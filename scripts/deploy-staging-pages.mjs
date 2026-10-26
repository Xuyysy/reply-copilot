import { spawnSync } from 'node:child_process';

const build = spawnSync('npm', ['run', 'build:pages:staging'], { stdio: 'inherit' });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const deploy = spawnSync('npx', [
  '--no-install',
  'wrangler',
  'pages',
  'deploy',
  'web/dist',
  '--project-name',
  'x-reply-helper-staging',
  '--branch',
  'codex/v0.4-credits',
], { stdio: 'inherit' });

if (deploy.error) throw deploy.error;
process.exit(deploy.status ?? 1);
