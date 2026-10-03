// Build-time values shared by every browser-test entry point. Keeping these
// here prevents Playwright's normal build and diagnose's PREBUILT path from
// exercising different artifacts.
import os from 'node:os';
import type { ReporterDescription } from '@playwright/test';

export const browserTestEnv = Object.freeze({
  PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
});

// Playwright workers: in CI the suite's own pin (or Playwright's default);
// locally half the cores, and one per 2.5 GB of memory. A worker with its
// browsers peaks near 0.8 GB (e2e at four workers measured 3.7 GB), so an
// 8 GB machine runs three.
export function workers(ci?: number): { workers?: number } {
  if (process.env.CI) return ci === undefined ? {} : { workers: ci };
  return { workers: Math.max(1, Math.min(Math.floor(os.availableParallelism() / 2), Math.floor(os.totalmem() / (2.5 * 2 ** 30)))) };
}

// Per-suite artifact paths, so suites running at the same time (diagnose runs
// edge and browser together) never empty each other's output. PLAYWRIGHT_REPORT
// adds the HTML report for the artifact and the JSON bin/playwright-summary.ts
// renders; without it, the list reporter alone. Workers and retries follow CI.
export function suiteArtifacts(suite: string): { outputDir: string; reporter: ReporterDescription[] } {
  return {
    outputDir: `test-results/${suite}`,
    reporter: process.env.PLAYWRIGHT_REPORT
      ? [
          ['list'],
          ['html', { open: 'never', outputFolder: `playwright-report/${suite}` }],
          ['json', { outputFile: `test-results/${suite}.json` }],
        ]
      : [['list']],
  };
}

// The Cloudflare runtime the edge suite serves the build through. The
// compatibility date must match the Pages project (Settings > Runtime in the
// Cloudflare dashboard) so local semantics are production semantics.
export const edgeRuntime = Object.freeze({
  port: 8788,
  compatibilityDate: '2026-05-19',
});

// `node tests/browser-test-env.ts build` builds the artifact the browser and
// edge suites serve, with the same values as their webServer builds. CI runs it
// while browser system packages install, then sets PREBUILT.
if (import.meta.main && process.argv[2] === 'build') {
  const { spawnSync } = await import('node:child_process');
  const { status } = spawnSync(process.execPath, ['bin/build-static.ts'], {
    stdio: 'inherit',
    env: { ...process.env, ...browserTestEnv },
  });
  process.exit(status ?? 1);
}
