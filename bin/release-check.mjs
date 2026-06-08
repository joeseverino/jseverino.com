#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const env = { ...process.env, ...(options.env ?? {}) };
  for (const name of options.unsetEnv ?? []) delete env[name];
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    env,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error(`\nfailed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

function gitStatus() {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: siteRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  return result.stdout;
}

const initialStatus = gitStatus();

if (process.platform !== 'darwin') {
  console.error(
    'failed: release:check requires macOS because the committed visual baselines are macOS Chromium images',
  );
  process.exit(1);
}

run('publish checks', npm, ['run', '-s', 'publish:check']);
run('repository policy', process.execPath, ['tests/audits/check-repository-policy.mjs']);

run(
  'functional and visual browser tests',
  npm,
  [
    'run',
    '-s',
    'test:e2e',
    '--',
    '--reporter=dot',
  ],
  {
    env: {
      CI: '1',
      ASTRO_TELEMETRY_DISABLED: '1',
      VISUAL: '1',
    },
    unsetEnv: ['NO_COLOR', 'FORCE_COLOR'],
  },
);

run('whitespace and conflict-marker check', 'git', ['diff', '--check']);

const finalStatus = gitStatus();
if (finalStatus !== initialStatus) {
  console.error(
    '\nfailed: release checks changed tracked or untracked repository state; review git status and commit generated/synced output before release',
  );
  process.exit(1);
}

console.log('\nok release-ready: repository policy, generated state, build, browser behavior, visuals, and diff checks passed');
