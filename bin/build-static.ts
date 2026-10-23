#!/usr/bin/env node
// `astro build`, then the CSP hashes. The build is the same for production and a preview:
// a preview deploy wraps it afterwards (bin/wrap-preview.ts). The output dir comes from
// src/lib/build-output.ts (shared with astro.config.ts).
import path from 'node:path';
import { buildOutDir, headersTemplate } from '../src/lib/build-output.ts';
import { permittedContentRoot } from '../src/lib/content-root.ts';
import { fromRoot, siteRoot } from '../src/lib/site-root.ts';
import { buildCsp } from './build-csp.ts';
import { cli, flag } from './lib/args.ts';
import { jsonLogs, spawnResult } from './lib/run.ts';

const { values } = cli({
  usage: 'usage: node bin/build-static.ts [--timings]',
  options: { timings: flag },
});

const contentOverride = process.env.SITE_CONTENT_ROOT;
if (contentOverride !== undefined && !permittedContentRoot(contentOverride, siteRoot)) {
  console.error(`build-static: SITE_CONTENT_ROOT=${contentOverride} is not under tests/fixtures; unset it to build src/content`);
  process.exit(2);
}
function run(command: string, args: readonly string[]): void {
  const { code } = spawnResult(command, args, { cwd: siteRoot, stdio: 'inherit' });
  if (code !== 0) process.exit(code);
}

// Before the build, so Astro copies it to the output (/content-index.json, gated by Access).
run(process.execPath, [path.join(siteRoot, 'bin/make-content-index.ts')]);
// Under `site --json`, Astro's JSON logger: one {message,label,level} line per event.
// Otherwise silent, unless --timings asks for the summary: a passing build has
// nothing to say, and Astro prints a fatal error and its stack at any level.
const logs = jsonLogs() ? ['--json'] : values.timings ? [] : ['--silent'];
// `astro` resolves from node_modules/.bin, which mise puts on PATH.
run('astro', ['build', ...logs, ...(values.timings ? ['--timings'] : [])]);
await buildCsp(fromRoot(buildOutDir), fromRoot(headersTemplate));
