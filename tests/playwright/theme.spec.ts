import { test, expect, type Page } from '@playwright/test';

// Neutral tokens use light-dark(); brand tokens use deterministic selectors from
// the shared brand emitter. What matters here is the resolved paint: auto tracks
// the OS with no JS, an explicit choice overrides it, and that choice survives a
// reload without a flash of the wrong scheme. Runs on every desktop engine.

const LIGHT_BG = 'rgb(255, 255, 255)';
const DARK_BG = 'rgb(19, 24, 38)';

const pageBg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);

const themeChoice = (page: Page, value: 'light' | 'dark' | 'auto') => page.locator(`[data-theme-choice="${value}"]`);

// The home page under an OS color preference.
async function homeIn(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('/');
}

// base.css carries the real `color-scheme`, but it only applies once the
// stylesheet has loaded. Until then the document scheme is `normal` and the
// browser paints a white canvas, light scrollbars, and light form controls even
// on a dark-mode OS, so the page starts light and turns dark. The head meta is
// parsed before any CSS and gets the first frame right (with the stylesheet
// aborted, the unstyled paint is dark with the meta and white without it).
// This checks the meta is present.
test('declares the color scheme before any stylesheet loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('head meta[name="color-scheme"]')).toHaveAttribute(
    'content',
    'light dark',
  );
});

test.describe('auto (default)', () => {
  test('follows a light OS preference', async ({ page }) => {
    await homeIn(page, 'light');
    expect(await pageBg(page)).toBe(LIGHT_BG);
    await expect(themeChoice(page, 'auto')).toHaveAttribute('aria-pressed', 'true');
  });

  test('follows a dark OS preference', async ({ page }) => {
    await homeIn(page, 'dark');
    expect(await pageBg(page)).toBe(DARK_BG);
  });

  test('raises cards above the page in dark', async ({ page }) => {
    await homeIn(page, 'dark');
    const card = await page
      .locator('.card-surface')
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(card).not.toBe(DARK_BG);
    expect(card).not.toBe('rgba(0, 0, 0, 0)');
  });
});

test.describe('explicit override', () => {
  test('pins light against a dark OS and survives a reload', async ({ page }) => {
    await homeIn(page, 'dark');
    await themeChoice(page, 'light').click();

    expect(await pageBg(page)).toBe(LIGHT_BG);
    await expect(themeChoice(page, 'light')).toHaveAttribute('aria-pressed', 'true');
    await expect(themeChoice(page, 'auto')).toHaveAttribute('aria-pressed', 'false');

    await page.reload();
    expect(await pageBg(page)).toBe(LIGHT_BG);
  });

  test('carries across a navigation', async ({ page }) => {
    await homeIn(page, 'light');
    await themeChoice(page, 'dark').click();
    await page.goto('/contact/');
    expect(await pageBg(page)).toBe(DARK_BG);
  });

  test('releases back to the OS on auto', async ({ page }) => {
    await homeIn(page, 'dark');
    await themeChoice(page, 'light').click();
    await themeChoice(page, 'auto').click();

    expect(await pageBg(page)).toBe(DARK_BG);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
  });

  test('repaints the mobile browser chrome', async ({ page }) => {
    await homeIn(page, 'light');
    await themeChoice(page, 'dark').click();

    const active = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
        .filter((meta) => meta.media === 'all')
        .map((meta) => meta.dataset.scheme),
    );
    expect(active).toEqual(['dark']);
  });
});

// Chromium and WebKit resolve a @keyframes block's var() colors once and keep
// the stale pair when color-scheme changes, so the sticky header's keyframe
// animates a plain number and the scrim color is composed outside it. Asserts
// the scrim tracks the current page scheme as it changes after load.
test('the sticky header scrim follows a runtime theme switch', async ({ page }) => {
  await homeIn(page, 'light');

  const scrimLightness = () =>
    page.evaluate(() => {
      const raw = getComputedStyle(document.querySelector('.site-header')!, '::before').backgroundColor;
      return Number(raw.match(/oklch\(([\d.]+)/)?.[1] ?? NaN);
    });

  expect(await scrimLightness()).toBeGreaterThan(0.9);

  await themeChoice(page, 'dark').click();

  await expect.poll(scrimLightness).toBeLessThan(0.4);
});

test('the control is keyboard operable', async ({ page }) => {
  await homeIn(page, 'light');
  await themeChoice(page, 'dark').press('Enter');
  expect(await pageBg(page)).toBe(DARK_BG);
});

test('auto still works with JavaScript off, and the control is hidden', async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    ...(baseURL ? { baseURL } : {}),
    colorScheme: 'dark',
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto('/');

  await expect(page.locator('.theme-toggle')).toBeHidden();
  expect(await pageBg(page)).toBe(DARK_BG);

  await context.close();
});
