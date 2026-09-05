import { defineConfig } from '@playwright/test';
import { browserTestEnv, ciReporters, edgeRuntime } from './tests/browser-test-env.mjs';

// The edge suite. `astro preview` serves static files only; the CSP
// middleware, the Pages Functions, and the public/_headers rules exist only on
// Cloudflare's runtime. `wrangler pages dev` runs that runtime against the
// built output, so tests/edge asserts the served responses before deploy.
const origin = `http://127.0.0.1:${edgeRuntime.port}`;

export default defineConfig({
  testDir: './tests/edge',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [...ciReporters] : 'list',
  use: {
    baseURL: origin,
  },
  projects: [{ name: 'edge' }],
  webServer: {
    // PREBUILT is set by bin/diagnose.mjs after its own build-static run, so
    // the suite serves that artifact instead of rebuilding it.
    command: [
      process.env.PREBUILT ? null : 'npm run build:static',
      'node bin/edge-serve.mjs',
    ].filter(Boolean).join(' && '),
    url: origin,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: browserTestEnv,
  },
});
