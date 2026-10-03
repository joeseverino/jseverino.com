import { test, expect, type Page } from '@playwright/test';

// Runs under tests/playwright.visual.config.ts against the fixture build
// (tests/fixtures/content), never real content: these routes are fixture
// slugs, so a publish cannot move a baseline. After an intended fixture or
// layout change, re-baseline with `npm run test:e2e:visual:update`.

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 412, height: 880 } as const;

const WRITEUP = '/portfolio/network-lab/'; // cover, figure, table
const TERMINAL_WRITEUP = '/portfolio/detection-pipeline/';
const TAG = '/tag/docker/'; // shared by two fixture writeups

const SCREENSHOT_OPTIONS = {
  animations: 'disabled',
  maxDiffPixelRatio: 0.01,
} as const;

// Deterministic readiness instead of networkidle: web fonts resolved and every
// eagerly loaded image decoded.
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((img) => img.loading !== 'lazy').every((img) => img.complete)))
    .toBe(true);
}

async function open(page: Page, path: string, viewport: { width: number; height: number } = DESKTOP_VIEWPORT) {
  await page.setViewportSize(viewport);
  await page.goto(path);
  await settle(page);
}

// The Turnstile widget renders on its own schedule and changes height when it
// does. Aborting its script leaves the reserved box empty, so the baseline
// pins this site's layout instead of Cloudflare's render timing.
const withoutTurnstile = (page: Page) =>
  page.route('https://challenges.cloudflare.com/**', (route) => route.abort());

async function expectContactScreenshot(page: Page, name: string): Promise<void> {
  await withoutTurnstile(page);
  await open(page, '/contact/');
  await expect(page.locator('.contact-intake-form')).toBeVisible();
  await expect(page).toHaveScreenshot(name, SCREENSHOT_OPTIONS);
}

test.describe('visual regression', () => {
  test('home page (desktop)', async ({ page }) => {
    await open(page, '/');
    await expect(page).toHaveScreenshot('home-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('home page (mobile)', async ({ page }) => {
    await open(page, '/', MOBILE_VIEWPORT);
    await expect(page).toHaveScreenshot('home-mobile.png', SCREENSHOT_OPTIONS);
  });

  test('mobile nav open', async ({ page }) => {
    await open(page, '/', MOBILE_VIEWPORT);
    await page.locator('[data-nav-toggle]').click();
    const nav = page.locator('[data-mobile-nav]');
    await expect(nav).toBeVisible();
    await expect.poll(() => nav.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
    await expect(page).toHaveScreenshot('mobile-nav-open.png', SCREENSHOT_OPTIONS);
  });

  test('writeup page (desktop)', async ({ page }) => {
    await open(page, WRITEUP);
    await expect(page).toHaveScreenshot('writeup-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('contact page (desktop)', async ({ page }) => {
    await expectContactScreenshot(page, 'contact-desktop.png');
  });

  test('portfolio archive open (desktop)', async ({ page }) => {
    await open(page, '/portfolio/');
    await page.locator('.archive-section summary').click();
    await expect(page.locator('.archive-taxonomy')).toBeVisible();
    await expect(page).toHaveScreenshot('portfolio-archive-open.png', SCREENSHOT_OPTIONS);
  });

  // Full-page so the featured cards and the compact list are both covered. The
  // fixture snapshot is fixed and fixture builds skip the registries, so
  // nothing here needs masking.
  test('portfolio software tab (desktop)', async ({ page }) => {
    await open(page, '/portfolio/#software');
    await expect(page.locator('[data-panel="software"]')).toBeVisible();
    await expect(page).toHaveScreenshot('portfolio-software-desktop.png', { ...SCREENSHOT_OPTIONS, fullPage: true });
  });

  test('portfolio software tab (mobile)', async ({ page }) => {
    await open(page, '/portfolio/#software', MOBILE_VIEWPORT);
    await expect(page.locator('[data-panel="software"]')).toBeVisible();
    await expect(page).toHaveScreenshot('portfolio-software-mobile.png', { ...SCREENSHOT_OPTIONS, fullPage: true });
  });

  test('tag page (desktop)', async ({ page }) => {
    await open(page, TAG);
    await expect(page).toHaveScreenshot('tag-docker-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('table block', async ({ page }) => {
    await open(page, WRITEUP);
    await expect(page.locator('.table-figure').first()).toHaveScreenshot('table-block.png', SCREENSHOT_OPTIONS);
  });

  test('terminal block', async ({ page }) => {
    await open(page, TERMINAL_WRITEUP);
    await expect(page.locator('.terminal-block').first()).toHaveScreenshot('terminal-block.png', SCREENSHOT_OPTIONS);
  });

  test('resume sticky action', async ({ page }) => {
    await open(page, '/resume/');
    await expect(page).toHaveScreenshot('resume-sticky-action.png', SCREENSHOT_OPTIONS);
  });

  // Dark flips tokens in the same stylesheet, so the layout matches light; these
  // baselines pin the resolved palette: page and raised surface, tinted table,
  // form fields, and the terminal group, which keeps its colors.
  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('home page (dark)', async ({ page }) => {
      await open(page, '/');
      await expect(page).toHaveScreenshot('home-desktop-dark.png', SCREENSHOT_OPTIONS);
    });

    test('writeup page (dark)', async ({ page }) => {
      await open(page, WRITEUP);
      await expect(page).toHaveScreenshot('writeup-desktop-dark.png', SCREENSHOT_OPTIONS);
    });

    test('contact page (dark)', async ({ page }) => {
      await expectContactScreenshot(page, 'contact-desktop-dark.png');
    });

    test('table block (dark)', async ({ page }) => {
      await open(page, WRITEUP);
      await expect(page.locator('.table-figure').first()).toHaveScreenshot('table-block-dark.png', SCREENSHOT_OPTIONS);
    });

    test('terminal block (dark)', async ({ page }) => {
      await open(page, TERMINAL_WRITEUP);
      await expect(page.locator('.terminal-block').first()).toHaveScreenshot('terminal-block-dark.png', SCREENSHOT_OPTIONS);
    });

    test('footer theme control (dark)', async ({ page }) => {
      await open(page, '/');
      await page.locator('.site-footer').scrollIntoViewIfNeeded();
      await expect(page.locator('.footer-inner')).toHaveScreenshot('footer-dark.png', SCREENSHOT_OPTIONS);
    });
  });
});
