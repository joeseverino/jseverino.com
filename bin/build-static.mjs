#!/usr/bin/env node
// Single source for the static build: `astro build`, then wrap the output with
// sitedrift. The output directory comes from src/lib/build-output.mjs — the
// same module astro.config.mjs uses — so sitedrift's --dir can never drift
// from where Astro actually wrote (the bug that left a stale `dist` and
// misled post-build audits). The --live origin and --brand come from the instance
// identity in site-config.mjs, not hardcoded strings.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE } from '../src/lib/site-config.mjs';
import { buildOutDir } from '../src/lib/build-output.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = buildOutDir();
const astro = path.join(siteRoot, 'node_modules/.bin/astro');
const sitedrift = path.join(siteRoot, 'node_modules/sitedrift/sitedrift.mjs');

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: siteRoot,
    stdio: 'inherit',
    env: { ...process.env, ASTRO_TELEMETRY_DISABLED: '1' },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(astro, ['build']);
run(process.execPath, [
  sitedrift,
  'cloudflare',
  '--dir', outDir,
  '--live', `https://${SITE.domain}`,
  '--brand', SITE.owner,
]);
