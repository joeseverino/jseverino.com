import { defineConfig, devices } from '@playwright/test';
import { previewServer, suiteArtifacts, workers } from './browser-test-env.ts';

const PORT = 4321;
const mobile = /\.mobile\.spec\.ts$/;
const single = /\.single\.spec\.ts$/;
// The visual suite renders fixture content; tests/playwright.visual.config.ts owns it.
const visualSpec = /visual\.spec\.ts$/;

// The preview serves production's headers. Cross-Origin-Opener-Policy moves Firefox's first
// navigation into a new browsing context group, which drops Playwright's emulated color scheme,
// so the page never sees dark mode; tests/edge asserts the header itself.
const firefox = { launchOptions: { firefoxUserPrefs: { 'browser.tabs.remote.useCrossOriginOpenerPolicy': false } } };

export default defineConfig({
  testDir: './playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // The retry records a trace and tells a flaky test from a broken one; either fails the run.
  retries: process.env.CI ? 1 : 0,
  failOnFlakyTests: true,
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
      use: { ...devices['Desktop Firefox'], ...firefox },
      testIgnore: [mobile, single, visualSpec],
    },
    {
      name: 'firefox-mobile',
      use: { ...devices['Desktop Firefox'], ...firefox, viewport: { width: 393, height: 851 } },
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
  webServer: previewServer({ port: PORT, timeout: 120_000 }),
});
