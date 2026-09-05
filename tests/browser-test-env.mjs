// Build-time values shared by every browser-test entry point. Keeping these
// here prevents Playwright's normal build and diagnose's PREBUILT path from
// exercising different artifacts.
export const browserTestEnv = Object.freeze({
  // Astro 7.1+ auto-detaches preview servers when it detects a coding agent.
  // Playwright already owns this process, so keep it in the foreground and
  // preserve one lifecycle locally, in CI, and under agent-driven diagnosis.
  ASTRO_PREVIEW_BACKGROUND: '1',
  PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
});

// Reporters every Playwright config uses under CI: the list for the log, the
// HTML report for the artifact, and the JSON that bin/playwright-summary.mjs
// renders into the job summary.
/** @type {import('@playwright/test').ReporterDescription[]} */
export const ciReporters = [
  ['list'],
  ['html', { open: 'never' }],
  ['json', { outputFile: 'test-results/results.json' }],
];

// The Cloudflare runtime the edge suite serves the build through. The
// compatibility date must match the Pages project (Settings > Runtime in the
// Cloudflare dashboard) so local semantics are production semantics.
export const edgeRuntime = Object.freeze({
  port: 8788,
  compatibilityDate: '2026-05-19',
});
