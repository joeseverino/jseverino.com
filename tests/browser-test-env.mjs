// Build-time values shared by every browser-test entry point. Keeping these
// here prevents Playwright's normal build and diagnose's PREBUILT path from
// exercising different artifacts.
export const browserTestEnv = Object.freeze({
  PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
});
