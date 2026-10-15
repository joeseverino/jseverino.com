#!/usr/bin/env node
// Run gate:check then publish:check as ci.yml does: CI set (localOnly audits skip)
// against the committed snapshot. Signature verification isolates its own keyring.
import { GATE_TIMEOUT_MS, run, status } from './lib/run.ts';
import { siteRoot } from '../src/lib/site-root.ts';

status('env', 'CI=1: localOnly audits skip as on the runner');

for (const [label, args] of [
  ['gate', ['run', '-s', 'gate:check']],
  ['publish gate', ['run', '-s', 'publish:check', '--', '--no-sync', '--after-gate']],
] as const) {
  const result = await run('npm', args, {
    cwd: siteRoot,
    env: { CI: '1' },
    timeout: GATE_TIMEOUT_MS,
    stdio: 'inherit',
  });
  if (result.code !== 0) {
    console.error(`\nfailed: the ${label} does not pass under CI conditions${result.timedOut ? ' (timed out)' : ''}`);
    process.exit(result.code);
  }
}
console.log('\nok ci-rehearsal: the gates pass with CI semantics and no authoring-machine keyring');
