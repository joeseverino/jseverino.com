import { BRAND, SURFACE } from '../../src/lib/brand.ts';
import { rgb } from './helpers/colors.ts';
import { boxOf, expect, type Page, test } from './helpers/test.ts';
import { anyWriteup } from './helpers/writeups.ts';

// The brand primary pair the page resolves on <html>.
async function expectBrandVars(page: Page, primary: string, deep: string): Promise<void> {
  const declared = (property: string) =>
    page.locator('html').evaluate((element, name) => getComputedStyle(element).getPropertyValue(name).trim().toLowerCase(), property);
  expect(await declared('--color-primary')).toBe(primary.toLowerCase());
  expect(await declared('--color-primary-deep')).toBe(deep.toLowerCase());
}

// Astro merges a page's own sheet into its <style> in an order of its choosing, so the
// cascade rests on the layer order every sheet declares first, never on source order.
// Layers rank in the order their names first appear, in a statement or a block.
for (const path of ['/', '/contact/', '/portfolio/', '/resume/', '/education/']) {
  test(`${path} ranks its layers in the declared order`, async ({ page }) => {
    await page.goto(path);
    const order = await page.evaluate(() => {
      const names = [...document.styleSheets].flatMap((sheet) =>
        [...sheet.cssRules].flatMap((rule) => {
          if (rule instanceof CSSLayerStatementRule) return [...rule.nameList];
          return rule instanceof CSSLayerBlockRule ? [rule.name] : [];
        }),
      );
      return [...new Set(names)];
    });
    expect(order).toEqual(['tokens', 'base', 'components', 'pages']);
  });
}

test('a #fragment target lands below the sticky header', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(anyWriteup());
  const id = await page.locator('.prose :is(h2, h3)[id]').first().getAttribute('id');
  expect(id).not.toBeNull();
  await page.goto(`${anyWriteup()}#${id}`);

  const header = await page.locator('.site-header').boundingBox();
  const target = await page.locator(`[id="${id}"]`).boundingBox();
  expect(header).not.toBeNull();
  expect(target).not.toBeNull();
  expect(target!.y).toBeGreaterThanOrEqual(header!.y + header!.height);
});

test('the nav underline animates without layout', async ({ page }) => {
  await page.goto('/resume/');
  const underline = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((link) => {
        const style = getComputedStyle(link, '::after');
        return {
          property: style.transitionProperty,
          width: link.getBoundingClientRect().width,
          drawn: Number.parseFloat(style.width) * Number(style.scale.split(' ')[0] ?? 1),
        };
      });
  const current = await underline('.nav-link[aria-current="page"]');
  expect(current.property).toBe('scale');
  expect(current.drawn).toBeCloseTo(current.width, 0);
  const other = await underline('.nav-link:not([aria-current])');
  expect(other.drawn).toBe(0);
});

test('focus exposes the skip link', async ({ page }) => {
  await page.goto('/');

  const skipLink = page.locator('.skip-link');
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveCSS('outline-style', 'solid');
});

// The browser toolbar takes the page background of each scheme, so it blends into the
// page instead of staying brand navy in both.
test('theme-color names the page surface of each scheme', async ({ page }) => {
  await page.goto('/portfolio/');
  await expect(page.locator('meta[name="theme-color"][data-scheme="light"]')).toHaveAttribute('content', new RegExp(SURFACE.light, 'i'));
  await expect(page.locator('meta[name="theme-color"][data-scheme="dark"]')).toHaveAttribute('content', new RegExp(SURFACE.dark, 'i'));
});

// First paint never waits on a stylesheet request.
test('the whole stylesheet is inlined in one style element', async ({ page }) => {
  await page.goto('/portfolio/');
  await expect(page.locator('link[rel="stylesheet"]')).toHaveCount(0);
  await expect(page.locator('head style')).toHaveCount(1);
});

test('light brand paint resolves on the root, the card links and the source link', async ({ page }) => {
  await page.goto('/portfolio/');
  await expectBrandVars(page, BRAND.navy, BRAND.navyDeep);

  const cardLink = page.locator('.project-card-title a').first();
  await cardLink.focus();
  await expect(cardLink).toHaveCSS('color', rgb(BRAND.navy));

  const sourceLink = page.locator('.source-link');
  await sourceLink.focus();
  await expect(sourceLink).toHaveCSS('color', rgb(BRAND.navyDeep));
  expect(await sourceLink.evaluate((element) => getComputedStyle(element).fontFamily)).toContain('Inter');
});

test('dark brand paint stays legible in links, navigation, and primary actions', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');

  await expectBrandVars(page, BRAND.onDark.primary, BRAND.onDark.primaryDeep);

  const button = page.locator('.button').first();
  await expect(button).toHaveCSS('background-color', rgb(BRAND.onDark.primary));
  await expect(button).toHaveCSS('color', rgb(SURFACE.dark));

  const cardLink = page.locator('.project-card-title a').first();
  await cardLink.focus();
  await expect(cardLink).toHaveCSS('color', rgb(BRAND.onDark.primary));

  await page.goto('/resume/');
  await expect(page.locator('.nav-link[aria-current="page"]')).toHaveCSS('color', rgb(BRAND.onDark.primary));
});

// A control that rises on hover stays under the pointer: hovered half a pixel inside its
// bottom edge, where the lift could carry it out from under the pointer and loop, it holds
// still and stays hovered; pressed at its center, it does not move, and the release
// follows its link.
for (const control of [
  { name: 'writeup card', path: '/portfolio/', target: '.project-card', lifted: '.card-surface', lift: '0px -2px', lands: /\/portfolio\/[^/]+\/$/ },
  { name: 'software card', path: '/portfolio/#software', target: '.software-card', lifted: '.card-surface', lift: '0px -2px' },
  { name: 'primary button', path: '/', target: '.button:not(.secondary)', lift: '0px -1px', lands: /\/resume\/$/ },
  { name: 'secondary button', path: '/', target: '.button.secondary', lift: '0px -1px', lands: /\/contact\/$/ },
]) {
  test(`a hovered or pressed ${control.name} does not shift`, async ({ page }) => {
    await page.goto(control.path);
    const target = page.locator(control.target).first();
    // The element the lift moves: the card's surface, or the button itself.
    const lifted = control.lifted ? target.locator(control.lifted) : target;
    await target.scrollIntoViewIfNeeded();
    await page.mouse.move(0, 0);
    const resting = await boxOf(target);
    await page.mouse.move(resting.x + resting.width / 2, resting.y + resting.height - 0.5);
    await expect(lifted).toHaveCSS('translate', control.lift);

    const raised = await boxOf(lifted);
    const frames = await lifted.evaluate(async (element, hoverZone) => {
      const zone = element.closest(hoverZone) ?? element;
      const samples: { x: number; y: number; hovered: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame);
        const rect = element.getBoundingClientRect();
        samples.push({ x: rect.x, y: rect.y, hovered: zone.matches(':hover') });
      }
      return samples;
    }, control.target);
    for (const frame of frames) expect(frame).toEqual({ x: expect.closeTo(raised.x, 1), y: expect.closeTo(raised.y, 1), hovered: true });

    await page.mouse.move(raised.x + raised.width / 2, raised.y + raised.height / 2);
    await page.mouse.down();
    expect(await boxOf(lifted)).toEqual(raised);
    // The software card's links open other sites, so its press is released away from it.
    if (!control.lands) await page.mouse.move(0, 0);
    await page.mouse.up();
    if (control.lands) await expect(page).toHaveURL(control.lands);
  });
}

test('reduced motion disables smooth scrolling and transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  await expect(page.locator('html')).toHaveCSS('scroll-behavior', 'auto');
  const duration = await page
    .locator('.button')
    .first()
    .evaluate((element) => {
      const value = getComputedStyle(element).transitionDuration;
      return Math.max(...value.split(',').map((item) => Number.parseFloat(item) || 0));
    });
  expect(duration).toBeLessThanOrEqual(0.00001);
});

test('cover images fill their fixed media boxes', async ({ page }) => {
  await page.goto('/portfolio/');

  const dimensions = await page
    .locator('.project-card-media')
    .first()
    .evaluate((media) => {
      const image = media.querySelector('img');
      if (!image) throw new Error('Expected project image');

      const mediaRect = media.getBoundingClientRect();
      const imageRect = image.getBoundingClientRect();
      return {
        mediaWidth: mediaRect.width,
        mediaHeight: mediaRect.height,
        imageWidth: imageRect.width,
        imageHeight: imageRect.height,
        objectFit: getComputedStyle(image).objectFit,
      };
    });

  expect(dimensions.objectFit).toBe('cover');
  expect(dimensions.imageWidth).toBeCloseTo(dimensions.mediaWidth, 0);
  expect(dimensions.imageHeight).toBeCloseTo(dimensions.mediaHeight, 0);
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
