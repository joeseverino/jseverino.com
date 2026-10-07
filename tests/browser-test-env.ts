// Build-time values shared by every browser-test entry point, so Playwright's
// build and diagnose's PREBUILT path serve the same artifact.
import os from 'node:os';
import type { ReporterDescription } from '@playwright/test';
import { fromRoot, siteRoot } from '../src/lib/site-root.ts';

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

// Per-suite artifact paths, so suites running at once never empty each other's output.
// PLAYWRIGHT_REPORT adds the HTML report and the JSON bin/playwright-summary.ts renders.
export function suiteArtifacts(suite: string): { outputDir: string; reporter: ReporterDescription[] } {
  return {
    outputDir: fromRoot('test-results', suite),
    reporter: process.env.PLAYWRIGHT_REPORT
      ? [
          ['list'],
          ['html', { open: 'never', outputFolder: fromRoot('playwright-report', suite) }],
          ['json', { outputFile: fromRoot('test-results', `${suite}.json`) }],
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
