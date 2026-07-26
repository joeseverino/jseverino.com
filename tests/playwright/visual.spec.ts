import { test, expect } from '@playwright/test';

// Unlike the functional specs (which resolve writeup URLs from the content
// snapshot via ./helpers/writeups.ts), this suite pins slugs on purpose: each committed
// baseline protects a specific page. Renaming one of these writeups means
// re-pinning the slug here and re-baselining that screenshot deliberately.

const SHOULD_RUN = process.env.VISUAL === '1';

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 412, height: 880 } as const;

const SCREENSHOT_OPTIONS = {
  animations: 'disabled',
  maxDiffPixelRatio: 0.01,
} as const;

test.describe('visual regression', () => {
  test.skip(!SHOULD_RUN, 'Set VISUAL=1 to run visual snapshots (baselines live in tests/playwright/visual.spec.ts-snapshots/).');
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

  // The Turnstile widget renders on its own schedule and changes height when it
  // does, shifting everything below it. Aborting the challenge script the same
  // way a11y.single.spec.ts does leaves the reserved 65px box empty, so the
  // baseline pins this site's layout instead of Cloudflare's render timing.
  const withoutTurnstile = (page: import('@playwright/test').Page) =>
    page.route('https://challenges.cloudflare.com/**', (route) => route.abort());

  test('contact page (desktop)', async ({ page }) => {
    await withoutTurnstile(page);
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/contact/');
    await expect(page.locator('.contact-intake-form')).toBeVisible();
    await expect(page).toHaveScreenshot('contact-desktop.png', SCREENSHOT_OPTIONS);
  });

  test('portfolio archive open (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/portfolio/');
    await page.waitForLoadState('networkidle');
    await page.locator('.archive-section summary').click();
    await expect(page.locator('.archive-taxonomy')).toBeVisible();
    await expect(page).toHaveScreenshot('portfolio-archive-open.png', SCREENSHOT_OPTIONS);
  });

  // Mask build-time-variable values (registry versions, download counts, and
  // last-pushed dates) so the baseline pins layout, not live numbers. Full-page
  // so the featured cards AND the compact "More projects" list are covered.
  function softwareShot(page: import('@playwright/test').Page, name: string) {
    return expect(page).toHaveScreenshot(name, {
      ...SCREENSHOT_OPTIONS,
      fullPage: true,
      mask: [
        page.locator('.badge--pypi, .badge--npm, .badge--muted'),
        page.locator('.software-meta, .sli-meta'),
      ],
    });
  }

  test('portfolio software tab (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/portfolio/#software');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-panel="software"]')).toBeVisible();
    await softwareShot(page, 'portfolio-software-desktop.png');
  });

  test('portfolio software tab (mobile)', async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto('/portfolio/#software');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('[data-panel="software"]')).toBeVisible();
    await softwareShot(page, 'portfolio-software-mobile.png');
  });

  test('tag page (desktop)', async ({ page }) => {
    await page.setViewportSize(DESKTOP_VIEWPORT);
    await page.goto('/tag/docker/');
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveScreenshot('tag-docker-desktop.png', SCREENSHOT_OPTIONS);
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

  // Dark is a token flip, not a second stylesheet, so these baselines are less
  // about layout (identical by construction) than about the resolved palette:
  // a dark value that lands wrong shows up here and nowhere else. The archetypes
  // are chosen for coverage of the surfaces that recolor independently — page
  // and raised surface, tinted table, form fields, and the terminal group that
  // deliberately does not recolor.
  test.describe('dark', () => {
    test.use({ colorScheme: 'dark' });

    test('home page (dark)', async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('home-desktop-dark.png', SCREENSHOT_OPTIONS);
    });

    test('writeup page (dark)', async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/portfolio/building-a-custom-mcp-layer/');
      await page.waitForLoadState('networkidle');
      await expect(page).toHaveScreenshot('writeup-desktop-dark.png', SCREENSHOT_OPTIONS);
    });

    test('contact page (dark)', async ({ page }) => {
      await withoutTurnstile(page);
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/contact/');
      await expect(page.locator('.contact-intake-form')).toBeVisible();
      await expect(page).toHaveScreenshot('contact-desktop-dark.png', SCREENSHOT_OPTIONS);
    });

    test('table block (dark)', async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/portfolio/building-a-custom-mcp-layer/');
      await expect(page.locator('.table-figure').first()).toHaveScreenshot('table-block-dark.png', SCREENSHOT_OPTIONS);
    });

    test('terminal block (dark)', async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/portfolio/building-study-quiz/');
      await expect(page.locator('.terminal-block').first()).toHaveScreenshot('terminal-block-dark.png', SCREENSHOT_OPTIONS);
    });

    test('footer theme control (dark)', async ({ page }) => {
      await page.setViewportSize(DESKTOP_VIEWPORT);
      await page.goto('/');
      await page.locator('.site-footer').scrollIntoViewIfNeeded();
      await expect(page.locator('.footer-inner')).toHaveScreenshot('footer-dark.png', SCREENSHOT_OPTIONS);
    });
  });
});
