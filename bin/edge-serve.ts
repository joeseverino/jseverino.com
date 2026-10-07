#!/usr/bin/env node
// Serve the build through the Cloudflare runtime so the CSP middleware, Pages
// Functions, and public/_headers are active (`astro preview` runs none). Port and
// compatibility date live in tests/browser-test-env.ts.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildOutDir } from '../src/lib/build-output.ts';
import { edgeRuntime } from '../tests/browser-test-env.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';

const child = spawn(
  path.join(root, 'node_modules/.bin/wrangler'),
  [
    'pages',
    'dev',
    buildOutDir,
    '--port',
    String(edgeRuntime.port),
    '--ip',
    '127.0.0.1',
    `--compatibility-date=${edgeRuntime.compatibilityDate}`,
  ],
  {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  },
);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
