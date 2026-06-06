import { test, expect } from '@playwright/test';

test('focus exposes the skip link', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.locator('.skip-link');
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveCSS('outline-style', 'solid');
});

test('brand tokens drive document chrome and interactive states', async ({ page }) => {
  await page.goto('/portfolio/');

  const brand = '#1e3a8a';
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', /#1E3A8A/i);
  await expect(page.locator('link[rel="stylesheet"][href="/brand.css"]')).toHaveCount(1);
  expect(
    await page
      .locator('html')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--color-primary').trim().toLowerCase(),
      ),
  ).toBe(brand);
  expect(
    await page
      .locator('html')
      .evaluate((element) =>
        getComputedStyle(element).getPropertyValue('--color-primary-deep').trim().toLowerCase(),
      ),
  ).toBe('#14245c');

  const cardLink = page.locator('.project-card-title a').first();
  await cardLink.focus();
  await expect(cardLink).toHaveCSS('color', 'rgb(30, 58, 138)');

  const sourceLink = page.locator('.source-link');
  await sourceLink.focus();
  await expect(sourceLink).toHaveCSS('color', 'rgb(20, 36, 92)');
  expect(await sourceLink.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Inter');
});

test('motion tokens drive stable pressed feedback', async ({ page }) => {
  await page.goto('/portfolio/');

  const root = page.locator('html');
  const standardDurationMs = await root.evaluate((element) => {
    const value = getComputedStyle(element)
      .getPropertyValue('--motion-duration-standard')
      .trim();
    return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  });
  expect(standardDurationMs).toBe(200);

  const cardLink = page.locator('.project-card-title a').first();
  const card = page.locator('.project-card').first();
  const box = await cardLink.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(card).toHaveCSS('translate', '0px -6px');
  const raisedCardBox = await card.boundingBox();
  expect(raisedCardBox).not.toBeNull();
  await expect(card).toHaveCSS('box-shadow', /.+/);
  await page.mouse.down();
  await expect(card).toHaveCSS('box-shadow', 'none');
  expect(await card.boundingBox()).toEqual(raisedCardBox);
  await page.mouse.move(0, 0);
  await page.mouse.up();

  await expect(card).toHaveCSS('transition-duration', '0.15s, 0.15s');
});

test('buttons and cards keep a stable click target through press and release', async ({ page }) => {
  await page.goto('/404.html');

  const button = page.getByRole('link', { name: 'View Portfolio' });
  const buttonBox = await button.boundingBox();
  expect(buttonBox).not.toBeNull();
  await page.mouse.move(
    buttonBox!.x + buttonBox!.width / 2,
    buttonBox!.y + buttonBox!.height / 2,
  );
  await expect(button).toHaveCSS('translate', '0px -2px');
  const raisedButtonBox = await button.boundingBox();
  expect(raisedButtonBox).not.toBeNull();
  await page.mouse.down();
  expect(await button.boundingBox()).toEqual(raisedButtonBox);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/portfolio\/$/);

  const cardLink = page.locator('.project-card-title a').first();
  const href = await cardLink.getAttribute('href');
  const cardBox = await cardLink.boundingBox();
  expect(href).not.toBeNull();
  expect(cardBox).not.toBeNull();
  await page.mouse.move(
    cardBox!.x + cardBox!.width / 2,
    cardBox!.y + cardBox!.height / 2,
  );
  await expect(page.locator('.project-card').first()).toHaveCSS('translate', '0px -6px');
  const raisedCardBox = await cardLink.boundingBox();
  expect(raisedCardBox).not.toBeNull();
  await page.mouse.down();
  expect(await cardLink.boundingBox()).toEqual(raisedCardBox);
  await page.mouse.up();
  await expect(page).toHaveURL(new RegExp(`${href!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
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
