import { defineConfig, devices } from '@playwright/test';
import { browserTestEnv, suiteArtifacts, workers } from './tests/browser-test-env.ts';

// The visual suite. It builds tests/fixtures/content (synthetic writeups and
// pages, a fixed GitHub snapshot, fixture images) into dist-visual/, so a
// content publish never moves a baseline; real content stays covered by e2e
// and the build audits. Baselines are macOS Chromium renders.
const PORT = 4322;
const astro = 'npx astro';
const config = '--config tests/fixtures/astro.config.ts';

export default defineConfig({
  testDir: './tests/playwright',
  testMatch: /visual\.spec\.ts$/,
  fullyParallel: true,
  ...workers(),
  forbidOnly: !!process.env.CI,
  // A screenshot that matches only on retry is a flake, so it fails.
  retries: 0,
  ...suiteArtifacts('visual'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // --ignore-lock: the e2e preview may be running at the same time.
    command: `${astro} build ${config} && ${astro} preview ${config} --host 127.0.0.1 --port ${PORT} --ignore-lock`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...browserTestEnv,
      ASTRO_TELEMETRY_DISABLED: '1',
      SITE_CONTENT_ROOT: 'tests/fixtures/content',
    },
  },
});
