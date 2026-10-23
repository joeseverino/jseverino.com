// Build-time values shared by every browser-test entry point, so Playwright's
// own build and the PREBUILT one (`mise run browser`, CI) serve the same artifact.
import os from 'node:os';
import type { PlaywrightTestConfig, ReporterDescription } from '@playwright/test';
import { fromCheckoutCache, siteRoot } from '../src/lib/site-root.ts';

export const browserTestEnv = Object.freeze({
  PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
});

// Playwright workers: CI uses the suite's pin or the default; locally half the cores,
// one per 2.5 GB of memory (a worker with its browsers peaks near 0.8 GB).
export function workers(ci?: number): { workers?: number } {
  if (process.env.CI) return ci === undefined ? {} : { workers: ci };
  return { workers: Math.max(1, Math.min(Math.floor(os.availableParallelism() / 2), Math.floor(os.totalmem() / (2.5 * 2 ** 30)))) };
}

// The configs live in tests/; servers and artifacts run from the repo root.
export const webServerCwd = siteRoot;

// Per-suite artifact paths in the checkout's cache, so suites running at once never empty
// each other's output. PLAYWRIGHT_REPORT adds the HTML report and the JSON
// bin/playwright-summary.ts renders.
export function suiteArtifacts(suite: string): { outputDir: string; reporter: ReporterDescription[] } {
  return {
    outputDir: fromCheckoutCache('test-results', suite),
    reporter: process.env.PLAYWRIGHT_REPORT
      ? [
          ['list'],
          ['html', { open: 'never', outputFolder: fromCheckoutCache('playwright-report', suite) }],
          ['json', { outputFile: fromCheckoutCache('test-results', `${suite}.json`) }],
        ]
      : [['list']],
  };
}

// The production build, served by `astro preview` through the Cloudflare adapter's local Worker
// runtime. It builds first unless PREBUILT is set, as `mise run browser` and CI do after their
// one build.
export function previewServer({ port, timeout }: { port: number; timeout: number }): NonNullable<PlaywrightTestConfig['webServer']> {
  return {
    cwd: webServerCwd,
    command: [
      process.env.PREBUILT ? null : 'node bin/build-static.ts',
      // --ignore-lock keeps the server in the foreground Playwright owns (Astro
      // detaches it when it detects an agent) and beside a running visual preview.
      `astro preview --host 127.0.0.1 --port ${port} --ignore-lock`,
    ]
      .filter(Boolean)
      .join(' && '),
    url: `http://127.0.0.1:${port}`,
    // A prebuilt artifact is served fresh, never by whatever holds the port.
    reuseExistingServer: !process.env.CI && !process.env.PREBUILT,
    timeout,
    stdout: 'ignore',
    stderr: 'pipe',
    env: browserTestEnv,
  };
}

// `node tests/browser-test-env.ts build` builds the artifact the browser and
// edge suites serve, with the same values as their webServer builds. CI runs it
// through `mise run setup:browsers`, then sets PREBUILT.
if (import.meta.main && process.argv[2] === 'build') {
  const { spawnSync } = await import('node:child_process');
  const { status } = spawnSync(process.execPath, ['bin/build-static.ts'], {
    stdio: 'inherit',
    env: { ...process.env, ...browserTestEnv },
  });
  process.exit(status ?? 1);
}
