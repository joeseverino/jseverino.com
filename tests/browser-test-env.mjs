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
