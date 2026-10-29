import { BRAND, SURFACE } from '../../src/lib/brand.ts';
import { rgb } from './helpers/colors.ts';
import { expect, type Page, settle, test } from './helpers/test.ts';
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
for (const path of ['/', '/contact/', '/portfolio/', '/resume/', '/education/']) {
  test(`${path} opens its stylesheet with the layer order`, async ({ page }) => {
    await page.goto(path);
    const first = await page.evaluate(() => {
      const rule = document.styleSheets[0]?.cssRules[0];
      return rule instanceof CSSLayerStatementRule ? [...rule.nameList] : null;
    });
    expect(first).toEqual(['tokens', 'base', 'components', 'pages']);
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

test('brand tokens drive document chrome and interactive states', async ({ page }) => {
  await page.goto('/portfolio/');

  // Chrome tint tracks the page background per theme, not the brand navy, so the
  // browser toolbar blends into the page instead of staying dark in both themes.
  await expect(page.locator('meta[name="theme-color"][data-scheme="light"]')).toHaveAttribute('content', new RegExp(SURFACE.light, 'i'));
  await expect(page.locator('meta[name="theme-color"][data-scheme="dark"]')).toHaveAttribute('content', new RegExp(SURFACE.dark, 'i'));
  // The whole stylesheet, brand vars included, is inlined: first paint never
  // waits on a stylesheet request.
  await expect(page.locator('link[rel="stylesheet"]')).toHaveCount(0);
  await expect(page.locator('head style')).toHaveCount(1);

  // The shared brand emitter resolves the light palette explicitly.
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

test('motion tokens drive stable pressed feedback', async ({ page }) => {
  await page.goto('/portfolio/');

  const root = page.locator('html');
  const standardDurationMs = await root.evaluate((element) => {
    const value = getComputedStyle(element).getPropertyValue('--motion-duration-standard').trim();
    return value.endsWith('ms') ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  });
  expect(standardDurationMs).toBe(200);

  const cardLink = page.locator('.project-card-title a').first();
  const card = page.locator('.card-surface').first();
  const box = await cardLink.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await expect(card).toHaveCSS('translate', '0px -2px');
  const raisedCardBox = await card.boundingBox();
  expect(raisedCardBox).not.toBeNull();
  await page.mouse.down();
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
  await page.mouse.move(buttonBox!.x + buttonBox!.width / 2, buttonBox!.y + buttonBox!.height / 2);
  await expect(button).toHaveCSS('translate', '0px -1px');
  const raisedButtonBox = await button.boundingBox();
  expect(raisedButtonBox).not.toBeNull();
  await page.mouse.down();
  expect(await button.boundingBox()).toEqual(raisedButtonBox);
  await page.mouse.up();
  await expect(page).toHaveURL(/\/portfolio\/$/);
  await settle(page);

  const cardLink = page.locator('.project-card-title a').first();
  const href = await cardLink.getAttribute('href');
  const cardBox = await cardLink.boundingBox();
  expect(href).not.toBeNull();
  expect(cardBox).not.toBeNull();
  await page.mouse.move(cardBox!.x + cardBox!.width / 2, cardBox!.y + cardBox!.height / 2);
  await expect(page.locator('.card-surface').first()).toHaveCSS('translate', '0px -2px');
  const raisedCardBox = await cardLink.boundingBox();
  expect(raisedCardBox).not.toBeNull();
  await page.mouse.down();
  expect(await cardLink.boundingBox()).toEqual(raisedCardBox);
  await page.mouse.up();
  await expect(page).toHaveURL(new RegExp(`${RegExp.escape(href!)}$`));
});

// Rests the pointer half a pixel inside the first match's bottom edge, coming from
// outside it, and returns the target with the box it had before the hover.
async function hoverBottomEdge(page: Page, selector: string) {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const box = await target.boundingBox();
  if (!box) throw new Error(`${selector} has no box`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 0.5);
  return { target, box };
}

// Sample the target geometry, including the bottom edge, where a raised hover
// state can move the target out from under the pointer and loop.
for (const { name, selector, path } of [
  { name: 'writeup card', selector: '.project-card', path: '/portfolio/' },
  { name: 'software card', selector: '.software-card', path: '/portfolio/#software' },
]) {
  test(`${name} stays stationary at its bottom hover edge`, async ({ page }) => {
    await page.goto(path);
    const { target, box } = await hoverBottomEdge(page, selector);
    await expect(target.locator('.card-surface')).toHaveCSS('translate', '0px -2px');
    const frames = await target.evaluate(async (element) => {
      const samples: { x: number; y: number; hovered: boolean }[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame);
        const rect = element.getBoundingClientRect();
        samples.push({ x: rect.x, y: rect.y, hovered: element.matches(':hover') });
      }
      return samples;
    });
    for (const frame of frames) {
      expect(frame.x).toBeCloseTo(box.x, 1);
      expect(frame.y).toBeCloseTo(box.y, 1);
      expect(frame.hovered).toBe(true);
    }
  });
}

for (const selector of ['.button:not(.secondary)', '.button.secondary']) {
  test(`${selector} keeps hover at its bottom border`, async ({ page }) => {
    await page.goto('/');
    const { target } = await hoverBottomEdge(page, selector);
    await expect(target).toHaveCSS('translate', '0px -1px');
    const hovered = await target.evaluate(async (element) => {
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame);
        if (!element.matches(':hover')) return false;
      }
      return true;
    });
    expect(hovered).toBe(true);
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
