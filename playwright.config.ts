import { defineConfig, devices } from '@playwright/test';
import { browserTestEnv, suiteArtifacts, workers } from './tests/browser-test-env.ts';

const PORT = 4321;
const mobile = /\.mobile\.spec\.ts$/;
const single = /\.single\.spec\.ts$/;
// The visual suite renders fixture content; playwright.visual.config.ts owns it.
const visualSpec = /visual\.spec\.ts$/;

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Four-core runners: three workers plus the preview server.
  ...workers(3),
  ...suiteArtifacts('e2e'),
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [mobile, visualSpec],
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: mobile,
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: [mobile, single, visualSpec],
    },
    {
      name: 'firefox-mobile',
      use: { ...devices['Desktop Firefox'], viewport: { width: 393, height: 851 } },
      testMatch: mobile,
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'] },
      testIgnore: [mobile, single, visualSpec],
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
      testMatch: mobile,
    },
  ],
  webServer: {
    // PREBUILT is set by bin/diagnose.ts (after its own build-static run) and
    // by CI (which builds while system dependencies install), so the suite
    // serves that artifact instead of rebuilding it.
    command: [
      process.env.PREBUILT ? null : 'npm run build:static',
      // --ignore-lock keeps the server in the foreground Playwright owns (Astro
      // detaches it when it detects an agent) and beside a running visual preview.
      `npm run preview -- --host 127.0.0.1 --port ${PORT} --ignore-lock`,
    ].filter(Boolean).join(' && '),
    url: `http://localhost:${PORT}`,
    // A prebuilt artifact is served fresh, never by whatever holds the port.
    reuseExistingServer: !process.env.CI && !process.env.PREBUILT,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: browserTestEnv,
  },
});
