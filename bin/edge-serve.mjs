#!/usr/bin/env node
// Serves the built output through the Cloudflare runtime, the way production
// serves it: the CSP middleware, the Pages Functions, and public/_headers are
// all active. `astro preview` runs none of them. The edge test suite and
// `npm run edge:serve` both start the runtime here, so the port and the
// compatibility date have one home (tests/browser-test-env.mjs).
import { spawn } from 'node:child_process';
import path from 'node:path';
import { buildOutDir } from '../src/lib/build-output.mjs';
import { edgeRuntime } from '../tests/browser-test-env.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const root = siteRoot;

const child = spawn(
  path.join(root, 'node_modules/.bin/wrangler'),
  [
    'pages',
    'dev',
    buildOutDir(),
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

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
