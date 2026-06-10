#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditsFor } from '../tests/audits/registry.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    env: { ...process.env, ...(options.env ?? {}) },
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

// The fast local build gate (its audits come from the shared registry).
run('publish checks', npm, ['run', '-s', 'publish:check']);

// The release-only audits — repository policy, whitespace/conflict markers, and
// the cross-browser + visual suite — also come from the registry, so this gate
// can never drift out of sync with what `diagnose` considers complete.
for (const audit of auditsFor('release')) {
  run(audit.name, audit.exec.cmd, audit.exec.args, { env: audit.exec.env });
}

// Idempotence: nothing above may have changed tracked or untracked state.
const finalStatus = gitStatus();
if (finalStatus !== initialStatus) {
  console.error(
    '\nfailed: release checks changed tracked or untracked repository state; review git status and commit generated/synced output before release',
  );
  process.exit(1);
}

console.log('\nok release-ready: repository policy, generated state, build, browser behavior, visuals, and diff checks passed');
