import { defineConfig } from '@playwright/test';
import { browserTestEnv, edgeRuntime, suiteArtifacts, webServerCwd, workers } from './browser-test-env.ts';

// The edge suite. `astro preview` serves static files only; the CSP
// middleware, the Pages Functions, and the public/_headers rules exist only on
// Cloudflare's runtime. `wrangler pages dev` runs that runtime against the
// built output, so tests/edge asserts the served responses before deploy.
const origin = `http://127.0.0.1:${edgeRuntime.port}`;

export default defineConfig({
  testDir: './edge',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  ...workers(1),
  ...suiteArtifacts('edge'),
  use: {
    baseURL: origin,
  },
  projects: [{ name: 'edge' }],
  webServer: {
    cwd: webServerCwd,
    // PREBUILT is set by bin/diagnose.ts after its own build-static run, so
    // the suite serves that artifact instead of rebuilding it.
    command: [
      process.env.PREBUILT ? null : 'npm run build:static',
      'node bin/edge-serve.ts',
    ].filter(Boolean).join(' && '),
    url: origin,
    // A prebuilt artifact is served fresh, never by whatever holds the port.
    reuseExistingServer: !process.env.CI && !process.env.PREBUILT,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: browserTestEnv,
  },
});
