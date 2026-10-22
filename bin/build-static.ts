#!/usr/bin/env node
// `astro build`, then wrap the output with sitedrift. The output dir comes from
// src/lib/build-output.ts (shared with astro.config.ts).
import path from 'node:path';
import { SITE, SITE_ORIGIN } from '../src/lib/site-config.ts';
import { buildOutDir } from '../src/lib/build-output.ts';
import { permittedContentRoot } from '../src/lib/content-root.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { CSP_INLINE_MARKER } from '../src/lib/csp.ts';
import { jsonLogs, spawnResult } from './lib/run.ts';
import { cli, flag } from './lib/args.ts';

const { values } = cli({
  usage: 'usage: node bin/build-static.ts [--timings]',
  options: { timings: flag },
});

const contentOverride = process.env.SITE_CONTENT_ROOT;
if (contentOverride !== undefined && !permittedContentRoot(contentOverride, siteRoot)) {
  console.error(`build-static: SITE_CONTENT_ROOT=${contentOverride} is not under tests/fixtures; unset it to build src/content`);
  process.exit(2);
}
const astro = path.join(siteRoot, 'node_modules/.bin/astro');
const sitedrift = path.join(siteRoot, 'node_modules/sitedrift/sitedrift.mjs');

// Cloudflare Pages builds without mise, so the build sets the variable mise's [env] sets everywhere else.
function run(command: string, args: readonly string[]): void {
  const { code } = spawnResult(command, args, { cwd: siteRoot, stdio: 'inherit', env: { ASTRO_TELEMETRY_DISABLED: '1' } });
  if (code !== 0) process.exit(code);
}

// Before the build, so Astro copies it to the output (/content-index.json, gated by Access).
run(process.execPath, [path.join(siteRoot, 'bin/make-content-index.ts')]);
// Under `site --json`, Astro's JSON logger: one {message,label,level} line per event.
// Otherwise silent, unless --timings asks for the summary: a passing build has
// nothing to say, and Astro prints a fatal error and its stack at any level.
const logs = jsonLogs() ? ['--json'] : values.timings ? [] : ['--silent'];
run(astro, ['build', ...logs, ...(values.timings ? ['--timings'] : [])]);
run(process.execPath, [
  sitedrift,
  'cloudflare',
  '--dir', buildOutDir,
  '--live', SITE_ORIGIN,
  '--brand', SITE.owner,
  // Every inline tag the viewer writes carries the marker build-csp hashes.
  '--nonce', CSP_INLINE_MARKER,
]);
// After the wrap, so the CSP hashes the pages as served.
run(process.execPath, [path.join(siteRoot, 'bin/build-csp.ts')]);
