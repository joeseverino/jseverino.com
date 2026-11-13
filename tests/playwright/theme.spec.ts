import { SURFACE } from '../../src/lib/brand.ts';
import { rgb } from './helpers/colors.ts';
import { expect, type Page, test } from './helpers/test.ts';

// Neutral tokens use light-dark(); brand tokens use deterministic selectors from
// the shared brand emitter. Asserts the resolved paint: auto tracks the OS with no JS,
// an explicit choice overrides it and survives a reload without a flash.

const LIGHT_BG = rgb(SURFACE.light);
const DARK_BG = rgb(SURFACE.dark);

const expectPageBg = (page: Page, color: string) => expect(page.locator('body')).toHaveCSS('background-color', color);

const CHOICE = { auto: 'Match system theme', light: 'Light theme', dark: 'Dark theme' } as const;
const themeChoice = (page: Page, value: keyof typeof CHOICE) => page.getByRole('button', { name: CHOICE[value], exact: true });

async function homeIn(page: Page, scheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('/');
}

// base.css sets `color-scheme` only once loaded; until then the browser paints a white
// canvas on a dark OS. The head meta is parsed first and fixes the first frame.
test('declares the color scheme before any stylesheet loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('head meta[name="color-scheme"]')).toHaveAttribute('content', 'light dark');
  const order = await page.evaluate(() =>
    [...document.head.children].flatMap((element) =>
      element.matches('meta[name="color-scheme"]') ? ['scheme'] : element.matches('style, link[rel="stylesheet"]') ? ['stylesheet'] : [],
    ),
  );
  expect(order[0]).toBe('scheme');
});

test.describe('auto (default)', () => {
  test('follows a light OS preference', async ({ page }) => {
    await homeIn(page, 'light');
    await expectPageBg(page, LIGHT_BG);
    await expect(themeChoice(page, 'auto')).toHaveAttribute('aria-pressed', 'true');
  });

  test('follows a dark OS preference', async ({ page }) => {
    await homeIn(page, 'dark');
    await expectPageBg(page, DARK_BG);
  });

  // In dark, a raised surface is lighter than the page under it.
  test('raises cards above the page in dark', async ({ page }) => {
    await homeIn(page, 'dark');
    const [card, body] = await page
      .locator('.card-surface')
      .first()
      .evaluate((element) => {
        // The color as the canvas paints it: [luminance, alpha], whatever syntax the style uses.
        const painted = (color: string) => {
          const context = document.createElement('canvas').getContext('2d');
          if (!context) throw new Error('no 2d canvas');
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const [r = 0, g = 0, b = 0, a = 0] = context.getImageData(0, 0, 1, 1).data;
          return [0.2126 * r + 0.7152 * g + 0.0722 * b, a];
        };
        return [painted(getComputedStyle(element).backgroundColor), painted(getComputedStyle(document.body).backgroundColor)];
      });
    expect(card?.[1], 'the card paints an opaque surface').toBe(255);
    expect(card?.[0]).toBeGreaterThan(body?.[0] ?? Number.POSITIVE_INFINITY);
  });
});

test.describe('explicit override', () => {
  test('pins light against a dark OS and survives a reload', async ({ page }) => {
    await homeIn(page, 'dark');
    await themeChoice(page, 'light').click();

    await expectPageBg(page, LIGHT_BG);
    await expect(themeChoice(page, 'light')).toHaveAttribute('aria-pressed', 'true');
    await expect(themeChoice(page, 'auto')).toHaveAttribute('aria-pressed', 'false');

    await page.reload();
    await expectPageBg(page, LIGHT_BG);
  });

  test('carries across a navigation', async ({ page }) => {
    await homeIn(page, 'light');
    await themeChoice(page, 'dark').click();
    await page.goto('/contact/');
    await expectPageBg(page, DARK_BG);
  });

  test('releases back to the OS on auto', async ({ page }) => {
    await homeIn(page, 'dark');
    await themeChoice(page, 'light').click();
    await themeChoice(page, 'auto').click();

    await expectPageBg(page, DARK_BG);
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
  });

  test('repaints the mobile browser chrome', async ({ page }) => {
    await homeIn(page, 'light');
    await themeChoice(page, 'dark').click();

    const active = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].filter((meta) => meta.media === 'all').map((meta) => meta.dataset.scheme),
    );
    expect(active).toEqual(['dark']);
  });
});

// Chromium and WebKit keep stale var() colors in @keyframes when color-scheme changes,
// so the scrim color is composed outside the keyframe. Asserts it tracks the page scheme.
test('the sticky header scrim follows a runtime theme switch', async ({ page }) => {
  await homeIn(page, 'light');

  const scrimLightness = () =>
    page.getByRole('banner').evaluate((header) => {
      const raw = getComputedStyle(header, '::before').backgroundColor;
      return Number(raw.match(/oklch\(([\d.]+)/)?.[1] ?? NaN);
    });

  expect(await scrimLightness()).toBeGreaterThan(0.9);

  await themeChoice(page, 'dark').click();

  await expect.poll(scrimLightness).toBeLessThan(0.4);
});

test('the control is keyboard operable', async ({ page }) => {
  await homeIn(page, 'light');
  await themeChoice(page, 'dark').press('Enter');
  await expectPageBg(page, DARK_BG);
});

test.describe('without JavaScript', () => {
  test.use({ colorScheme: 'dark', javaScriptEnabled: false });

  test('auto still works, and the control is hidden', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('group', { name: 'Color theme', includeHidden: true })).toBeHidden();
    await expectPageBg(page, DARK_BG);
  });
});
