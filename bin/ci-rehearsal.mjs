#!/usr/bin/env node
// Rehearse the CI build gate locally before pushing: run publish:check the way
// .github/workflows/build.yml runs it — CI set (so localOnly audits skip, the
// same as on the runner) and a scratch GPG keyring seeded only from the
// committed WKD key, so the gate cannot silently lean on this machine's
// keyring, vault, or any other authoring-machine state. This is the harness
// that would have caught a "passes locally, fails on the runner" gap without
// a push to main.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, status } from './lib/run.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
  status('env', 'CI=1 — localOnly audits skip exactly as on the runner');

  const gate = await run('npm', ['run', '-s', 'publish:check', '--', '--no-sync'], {
    cwd: siteRoot,
    env: { CI: '1', GNUPGHOME: gnupgHome },
    timeout: 30 * 60_000,
    stdio: 'inherit',
  });

  if (gate.code !== 0) {
    console.error(`\nfailed: the publish gate does not pass under CI conditions${gate.timedOut ? ' (timed out)' : ''}`);
    process.exit(gate.code);
  }
  console.log('\nok ci-rehearsal: the gate passes with CI semantics and no authoring-machine keyring');
} finally {
  fs.rmSync(gnupgHome, { recursive: true, force: true });
}
