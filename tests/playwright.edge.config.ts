import { defineConfig } from '@playwright/test';
import { browserTestEnv, edgeRuntime, suiteArtifacts, webServerCwd, workers } from './browser-test-env.ts';

// `astro preview` serves static files only. `wrangler pages dev` runs the CSP middleware,
// Pages Functions, and public/_headers against the build, so tests/edge asserts them.
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
    // PREBUILT is set by bin/diagnose.ts after its own build.
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
