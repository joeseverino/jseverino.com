#!/usr/bin/env node
import { auditsFor } from '../tests/audits/registry.ts';
import { cli } from './lib/args.ts';
import { runAudit } from './lib/audits.ts';
import { statusEntries } from './lib/git.ts';
import { GATE_TIMEOUT_MS, run as spawnRun, type RunResult } from './lib/run.ts';
import { siteRoot } from '../src/lib/site-root.ts';

cli({ usage: 'usage: node bin/release-check.ts' });
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function failed(label: string, result: Pick<RunResult, 'code' | 'timedOut'>): never {
  console.error(`\nfailed: ${label}${result.timedOut ? ' (timed out)' : ''}`);
  process.exit(result.code || 1);
}

const gitStatus = (): string => statusEntries(siteRoot).join('\n');

const initialStatus = gitStatus();

if (process.platform !== 'darwin') {
  console.error(
    'failed: release:check requires macOS because the committed visual baselines are macOS Chromium images',
  );
  process.exit(1);
}

// The fast local build gate (its audits come from the shared registry).
// Streams output live, for a person watching the gate.
console.log('\n==> publish checks');
const gate = await spawnRun(npm, ['run', '-s', 'publish:check'], { cwd: siteRoot, timeout: GATE_TIMEOUT_MS, stdio: 'inherit' });
if (gate.code !== 0) failed('publish checks', gate);

// The release-only audits (repository policy, whitespace/conflict markers, the
// browser and edge suites) also come from the registry.
for (const audit of auditsFor('release')) {
  console.log(`\n==> ${audit.name}`);
  const result = await runAudit(audit, { stdio: 'inherit' });
  if (result.skipped) console.log(result.detail);
  if (result.ok === false) failed(audit.name, result);
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
