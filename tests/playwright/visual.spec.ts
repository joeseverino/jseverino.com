import { test, expect } from '@playwright/test';

const SHOULD_RUN = process.env.VISUAL === '1';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 412, height: 880 } as const;

const SCREENSHOT_OPTIONS = {
  animations: 'disabled',
  maxDiffPixelRatio: 0.01,
} as const;

test.describe('visual regression', () => {
  test.skip(!SHOULD_RUN, 'Set VISUAL=1 to run visual snapshots (baselines live in tests/visual.spec.ts-snapshots/).');
  test.skip(({ browserName }) => browserName !== 'chromium', 'Visual baselines use Chromium to avoid engine-specific rasterization noise.');

  test('home page (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('home-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('home page (mobile)', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('home-mobile.png', SCREENSHOT_OPTIONS);
  });

  test('mobile nav open', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/');
    await page.locator('[data-nav-toggle]').click();
    await expect(page.locator('[data-mobile-nav]')).toBeVisible();
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot('mobile-nav-open.png', SCREENSHOT_OPTIONS);
  });

  test('writeup page (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/portfolio/building-a-custom-mcp-layer/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('writeup-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('contact page (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/contact/');
    await expect(page.locator('.contact-intake-form')).toBeVisible();
    await expect(page).toHaveScreenshot('contact-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('table block', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/portfolio/building-a-custom-mcp-layer/');
    await expect(page.locator('.table-figure').first()).toHaveScreenshot('table-block.png', SCREENSHOT_OPTIONS);
  });

  test('terminal block', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/portfolio/building-study-quiz/');
    await expect(page.locator('.terminal-block').first()).toHaveScreenshot('terminal-block.png', SCREENSHOT_OPTIONS);
  });

  test('resume sticky action', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/resume/');
    await expect(page).toHaveScreenshot('resume-sticky-action.png', SCREENSHOT_OPTIONS);
  });
});
