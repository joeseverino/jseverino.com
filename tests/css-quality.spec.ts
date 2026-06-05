import { test, expect } from '@playwright/test';

test('focus exposes the skip link', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.locator('.skip-link');
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveCSS('outline-style', 'solid');
});

test('reduced motion disables smooth scrolling and transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  const duration = await page.locator('.button').first().evaluate((element) => {
    const value = getComputedStyle(element).transitionDuration;
    return Math.max(...value.split(',').map((item) => Number.parseFloat(item) || 0));
  });
  expect(duration).toBeLessThanOrEqual(0.00001);
});

test('cover images fill their fixed media boxes', async ({ page }) => {
  await page.goto('/portfolio/');

  const dimensions = await page.locator('.project-card-media').first().evaluate((media) => {
    const image = media.querySelector('img');
    const picture = media.querySelector('picture');
    if (!image || !picture) throw new Error('Expected project picture and image');

    const mediaRect = media.getBoundingClientRect();
    const imageRect = image.getBoundingClientRect();
    return {
      mediaWidth: mediaRect.width,
      mediaHeight: mediaRect.height,
      imageWidth: imageRect.width,
      imageHeight: imageRect.height,
      objectFit: getComputedStyle(image).objectFit,
      pictureDisplay: getComputedStyle(picture).display,
    };
  });

  expect(dimensions.pictureDisplay).toBe('contents');
  expect(dimensions.objectFit).toBe('cover');
  expect(dimensions.imageWidth).toBeCloseTo(dimensions.mediaWidth, 0);
  expect(dimensions.imageHeight).toBeCloseTo(dimensions.mediaHeight, 0);
});

test('tables stay contained at narrow widths', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('/portfolio/building-a-custom-mcp-layer/');

  const table = page.locator('.table-figure').first();
  await expect(table).toHaveCSS('overflow-x', 'auto');
  const box = await table.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
});

test('sticky resume action remains fixed and centered', async ({ page }) => {
  await page.goto('/resume/');

  const button = page.locator('.sticky-button');
  await expect(button).toHaveCSS('position', 'fixed');
  const box = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x + box!.width / 2).toBeCloseTo(viewport!.width / 2, 0);
});

test('forced colors preserve visible controls and focus', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Forced-colors emulation is Chromium-only in this suite.');
  await page.emulateMedia({ forcedColors: 'active' });
  await page.goto('/contact/');

  const input = page.locator('#contact-name');
  await input.focus();
  await expect(input).toHaveCSS('outline-style', 'solid');
  await expect(page.locator('.contact-submit')).toHaveCSS('border-style', 'solid');
});
