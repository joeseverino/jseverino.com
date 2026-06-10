import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

export default defineConfig({
  testDir: './tests/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /.*mobile.*\.spec\.ts/,
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Pixel 5'] },
      testMatch: /.*mobile.*\.spec\.ts/,
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'] },
      testIgnore: [/.*mobile.*\.spec\.ts/, /.*\.single\.spec\.ts/],
    },
    {
      name: 'firefox-mobile',
      use: { ...devices['Desktop Firefox'], viewport: { width: 393, height: 851 } },
      testMatch: /.*mobile.*\.spec\.ts/,
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'] },
      testIgnore: [/.*mobile.*\.spec\.ts/, /.*\.single\.spec\.ts/],
    },
    {
      name: 'webkit-mobile',
      use: { ...devices['iPhone 13'] },
      testMatch: /.*mobile.*\.spec\.ts/,
    },
  ],
  webServer: {
    // PREBUILT is set by bin/diagnose.mjs after its own build-static run, so
    // the suite serves that artifact instead of rebuilding it.
    command: [
      process.env.PREBUILT ? null : 'npm run build:static',
      `npm run preview -- --host 127.0.0.1 --port ${PORT}`,
    ].filter(Boolean).join(' && '),
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
    },
  },
});
