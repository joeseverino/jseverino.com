import { expect, type Page, test } from './helpers/test.ts';
import { imageHeavyWriteup } from './helpers/writeups.ts';

// Headless Chromium hides scrollbars; shown, Linux and Windows draw the classic scrollbar that
// takes width, and a scroll lock that removes it would shift the page. macOS overlays its
// scrollbars, which take none, so there is nothing to measure there.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function expectStillWhileLocked(page: Page, anchor: string, open: () => Promise<void>) {
  const scrollbar = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
  test.skip(scrollbar === 0, 'This platform overlays its scrollbars.');
  const before = await page.locator(anchor).boundingBox();
  await open();
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  expect(await page.locator(anchor).boundingBox()).toEqual(before);
}

test('opening the lightbox leaves the page where it was', async ({ page }) => {
  await page.goto(imageHeavyWriteup());
  await expectStillWhileLocked(page, '.primary-nav', async () => {
    await page.locator('.prose .image-zoom').first().click();
    await expect(page.locator('dialog.lightbox')).toBeVisible();
  });
});

test('opening the mobile menu leaves the header where it was', async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto('/resume/');
  await expectStillWhileLocked(page, '.nav-toggle', async () => {
    await page.locator('.nav-toggle').click();
    await expect(page.locator('.mobile-nav')).toBeVisible();
  });
});
