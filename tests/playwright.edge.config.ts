import { defineConfig } from '@playwright/test';
import { browserTestEnv, edgeRuntime, suiteArtifacts, webServerCwd, workers } from './browser-test-env.ts';

// `astro preview` serves the build through the Cloudflare adapter's local Worker runtime, which
// applies _headers, _redirects, wrangler.jsonc's asset handling and the API routes, so
// tests/edge asserts them as production serves them.
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
    // PREBUILT is set by `mise run browser` after its one build, and by CI, which builds while system deps install.
    command: [
      process.env.PREBUILT ? null : 'node bin/build-static.ts',
      // --ignore-lock: see tests/playwright.config.ts.
      `npx astro preview --host 127.0.0.1 --port ${edgeRuntime.port} --ignore-lock`,
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
