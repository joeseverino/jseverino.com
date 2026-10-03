#!/usr/bin/env node
// The static build: `astro build`, then wrap the output with sitedrift. The
// output directory comes from src/lib/build-output.ts, the module
// astro.config.ts uses, so sitedrift's --dir is where Astro wrote. The --live
// origin and --brand come from the instance identity in site-config.ts.
import path from 'node:path';
import { SITE, SITE_ORIGIN } from '../src/lib/site-config.ts';
import { buildOutDir } from '../src/lib/build-output.ts';
import { permittedContentRoot } from '../src/lib/content-root.ts';
import { siteRoot } from '../src/lib/site-root.ts';
import { CSP_NONCE_PLACEHOLDER } from '../functions/lib/csp-nonce.ts';
import { jsonLogs, spawnResult } from './lib/run.ts';
import { writeStaticFallbacks } from './lib/pages-routes.ts';

const outDir = buildOutDir;
const contentOverride = process.env.SITE_CONTENT_ROOT;
if (contentOverride !== undefined && !permittedContentRoot(contentOverride, siteRoot)) {
  console.error(`build-static: SITE_CONTENT_ROOT=${contentOverride} is neither under tests/fixtures nor the drafts overlay (.cache/drafts); unset it to build src/content`);
  process.exit(2);
}
const astro = path.join(siteRoot, 'node_modules/.bin/astro');
const sitedrift = path.join(siteRoot, 'node_modules/sitedrift/sitedrift.mjs');

function run(command: string, args: readonly string[]): void {
  const { code } = spawnResult(command, args, { cwd: siteRoot, stdio: 'inherit', env: { ASTRO_TELEMETRY_DISABLED: '1' } });
  if (code !== 0) process.exit(code);
}

// Emit the HQ content index into public/ before the build so Astro copies it
// into the deploy output (served at /content-index.json, gated by Access).
run(process.execPath, [path.join(siteRoot, 'bin/make-content-index.ts')]);
// Under `site --json`, Astro's JSON logger: one {message,label,level} line per event.
run(astro, jsonLogs() ? ['build', '--json'] : ['build']);
run(process.execPath, [
  sitedrift,
  'cloudflare',
  '--dir', outDir,
  '--live', SITE_ORIGIN,
  '--brand', SITE.owner,
  // Every tag the viewer writes carries the placeholder the middleware nonces.
  '--nonce', CSP_NONCE_PLACEHOLDER,
]);
// The 404 pages for misses under excluded prefixes, after the wrap so a
// preview build serves them as written.
writeStaticFallbacks(path.join(siteRoot, outDir));
