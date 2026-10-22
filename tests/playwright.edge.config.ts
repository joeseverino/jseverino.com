import { defineConfig } from '@playwright/test';
import { previewServer, suiteArtifacts, workers } from './browser-test-env.ts';

// `astro preview` serves the build through the Cloudflare adapter's local Worker runtime, which
// applies _headers, _redirects, wrangler.jsonc's asset handling and the API routes, so
// tests/edge asserts them as production serves them.
const PORT = 8788;

export default defineConfig({
  testDir: './edge',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  ...workers(1),
  ...suiteArtifacts('edge'),
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
  },
  projects: [{ name: 'edge' }],
  webServer: previewServer({ port: PORT, timeout: 180_000 }),
});
