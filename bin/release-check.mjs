#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditsFor } from '../tests/audits/registry.mjs';
import { run as spawnRun } from './lib/run.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Streams output live (this gate is watched, not parsed) and fails fast.
async function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = await spawnRun(command, args, {
    cwd: siteRoot,
    env: options.env,
    timeout: options.timeout,
    stdio: 'inherit',
  });

  if (result.code !== 0) {
    console.error(`\nfailed: ${label}${result.timedOut ? ' (timed out)' : ''}`);
    process.exit(result.code);
  }
}

async function gitStatus() {
  const result = await spawnRun('git', ['status', '--porcelain=v1', '-z'], { cwd: siteRoot });
  if (result.code !== 0) process.exit(result.code);
  return result.stdout;
}

const initialStatus = await gitStatus();

if (process.platform !== 'darwin') {
  console.error(
    'failed: release:check requires macOS because the committed visual baselines are macOS Chromium images',
  );
  process.exit(1);
}

// The fast local build gate (its audits come from the shared registry).
await run('publish checks', npm, ['run', '-s', 'publish:check'], { timeout: 30 * 60_000 });

// The release-only audits — repository policy, whitespace/conflict markers, and
// the cross-browser + visual suite — also come from the registry, so this gate
// can never drift out of sync with what `diagnose` considers complete.
for (const audit of auditsFor('release')) {
  await run(audit.name, audit.exec.cmd, audit.exec.args, {
    env: audit.exec.env,
    timeout: audit.timeout,
  });
}

// Idempotence: nothing above may have changed tracked or untracked state.
const finalStatus = await gitStatus();
if (finalStatus !== initialStatus) {
  console.error(
    '\nfailed: release checks changed tracked or untracked repository state; review git status and commit generated/synced output before release',
  );
  process.exit(1);
}

console.log('\nok release-ready: repository policy, generated state, build, browser behavior, visuals, and diff checks passed');
