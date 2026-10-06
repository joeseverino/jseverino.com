#!/usr/bin/env node
// Rehearse the CI build gate locally before pushing: run gate:check, then
// publish:check, the way .github/workflows/ci.yml runs them: CI set (so localOnly audits skip, as on
// the runner) and a scratch GPG keyring seeded only from the committed WKD
// key, so the gate cannot lean on this machine's keyring, vault, or other
// authoring-machine state.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATE_TIMEOUT_MS, run, status } from './lib/run.ts';
import { siteRoot } from '../src/lib/site-root.ts';

const wkdDir = path.join(siteRoot, 'public/.well-known/openpgpkey/hu');

const gnupgHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-rehearsal-gnupg-'));
fs.chmodSync(gnupgHome, 0o700);

try {
  const keyFiles = fs.readdirSync(wkdDir).map((name) => path.join(wkdDir, name));
  const imported = await run('gpg', ['--import', ...keyFiles], {
    cwd: siteRoot,
    env: { GNUPGHOME: gnupgHome },
  });
  if (imported.code !== 0) {
    console.error(`failed: could not seed the scratch keyring from ${path.relative(siteRoot, wkdDir)}`);
    console.error(imported.stderr.trim());
    process.exit(imported.code);
  }
  status('keyring', `scratch GNUPGHOME seeded from the committed WKD key (${keyFiles.length} file(s))`);
  status('env', 'CI=1: localOnly audits skip as on the runner');

  for (const [label, args] of [
    ['gate', ['run', '-s', 'gate:check']],
    ['publish gate', ['run', '-s', 'publish:check', '--', '--no-sync', '--after-gate']],
  ] as const) {
    const result = await run('npm', args, {
      cwd: siteRoot,
      env: { CI: '1', GNUPGHOME: gnupgHome },
      timeout: GATE_TIMEOUT_MS,
      stdio: 'inherit',
    });
    if (result.code !== 0) {
      console.error(`\nfailed: the ${label} does not pass under CI conditions${result.timedOut ? ' (timed out)' : ''}`);
      process.exit(result.code);
    }
  }
  console.log('\nok ci-rehearsal: the gates pass with CI semantics and no authoring-machine keyring');
} finally {
  fs.rmSync(gnupgHome, { recursive: true, force: true });
}
