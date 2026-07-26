import { test, expect } from '@playwright/test';

// Neutral tokens use light-dark(); brand tokens use deterministic selectors from
// the shared brand emitter. What matters here is the resolved paint: auto tracks
// the OS with no JS, an explicit choice overrides it, and that choice survives a
// reload without a flash of the wrong scheme. Runs on every desktop engine.

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(19, 24, 38)';

const pageBg = (page: import('@playwright/test').Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

// base.css carries the real `color-scheme`, but it only applies once the
// stylesheet has loaded. Until then the document scheme is `normal` and the
// browser paints a white canvas, light scrollbars, and light form controls even
// on a dark-mode OS — the page visibly starts light and turns dark. The head
// meta is parsed before any CSS and gets the first frame right. Verified by
// aborting the stylesheet: with the meta the unstyled paint is dark, without it
// white. Cheap presence check here; the paint proof is in the commit.
test('declares the color scheme before any stylesheet loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('head meta[name="color-scheme"]')).toHaveAttribute(
    'content',
    'light dark',
  );
});

test.describe('auto (default)', () => {
  test('follows a light OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    expect(await pageBg(page)).toBe(LIGHT_BG);
    await expect(page.locator('[data-theme-choice="auto"]')).toHaveAttribute('aria-pressed', 'true');
  });

  test('follows a dark OS preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    expect(await pageBg(page)).toBe(DARK_BG);
  });

  test('raises cards above the page in dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const card = await page
      .locator('.project-card')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(card).not.toBe(DARK_BG);
  });
});

test.describe('explicit override', () => {
  test('pins light against a dark OS and survives a reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.locator('[data-theme-choice="light"]').click();

    expect(await pageBg(page)).toBe(LIGHT_BG);
    await expect(page.locator('[data-theme-choice="light"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-theme-choice="auto"]')).toHaveAttribute('aria-pressed', 'false');

    await page.reload();
    expect(await pageBg(page)).toBe(LIGHT_BG);
  });

  test('carries across a navigation', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.locator('[data-theme-choice="dark"]').click();
    await page.goto('/contact/');
    expect(await pageBg(page)).toBe(DARK_BG);
  });

  test('releases back to the OS on auto', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.locator('[data-theme-choice="light"]').click();
    await page.locator('[data-theme-choice="auto"]').click();

    expect(await pageBg(page)).toBe(DARK_BG);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
  });

  test('repaints the mobile browser chrome', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.locator('[data-theme-choice="dark"]').click();

    const active = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
        .filter((meta) => meta.media === 'all')
        .map((meta) => meta.dataset.scheme),
    );
    expect(active).toEqual(['dark']);
  });
});

// Regression: the sticky header's scrim used to come from a @keyframes block
// holding `color-mix(… var(--color-bg) …)`. Both Chromium and WebKit resolve a
// keyframe's var() colors once and keep serving the stale pair when color-scheme
// changes, so switching to dark left a white bar over a dark page until the next
// reload. The keyframe now animates a plain number and the color is composed
// outside it. Asserts the scrim tracks the PAGE, not the scheme at load time.
test('the sticky header scrim follows a runtime theme switch', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');

  const scrimLightness = () =>
    page.evaluate(() => {
      const raw = getComputedStyle(document.querySelector('.site-header')!, '::before').backgroundColor;
      return Number(raw.match(/oklch\(([\d.]+)/)?.[1] ?? NaN);
    });

  expect(await scrimLightness()).toBeGreaterThan(0.9);

  await page.locator('[data-theme-choice="dark"]').click();
  await page.waitForTimeout(200);

  expect(await scrimLightness()).toBeLessThan(0.4);
});

test('the control is keyboard operable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.locator('[data-theme-choice="dark"]').press('Enter');
  expect(await pageBg(page)).toBe(DARK_BG);
});

test('auto still works with JavaScript off, and the control is hidden', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    colorScheme: 'dark',
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.locator('.theme-toggle')).toBeHidden();
  expect(await pageBg(page)).toBe(DARK_BG);

  await context.close();
});
