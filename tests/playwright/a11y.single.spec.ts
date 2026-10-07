import { test, expect, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import { anyWriteup, imageHeavyWriteup } from './helpers/writeups.ts';

const scan = (page: Page) =>
  new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();

const summarize = (results: Awaited<ReturnType<typeof scan>>) =>
  results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact}): ${violation.help}; ${violation.nodes.length} node(s), e.g. ${violation.nodes[0]?.target}`,
  );

// axe-core over the key page archetypes. check-html covers cheap structural rules;
// this runs the full WCAG A/AA ruleset where contrast and landmarks resolve.
// Engine-independent, so *.single.

const pages = ['/', '/portfolio/', anyWriteup(), '/contact/', '/resume/'];

// Abort the Turnstile script as contact.spec.ts does: it keeps network activity alive
// on CI (so do not wait for networkidle), and axe should scan only the site's markup.
test.beforeEach(async ({ page }) => {
  await page.route('https://challenges.cloudflare.com/**', (route) => route.abort());
});

for (const path of pages) {
  test(`axe finds no WCAG A/AA violations on ${path}`, async ({ page }) => {
    await page.goto(path, { waitUntil: 'load' });
    expect(summarize(await scan(page))).toEqual([]);
  });
}

test('axe finds no WCAG A/AA violations with the lightbox open', async ({ page }) => {
  await page.goto(imageHeavyWriteup(), { waitUntil: 'load' });
  await page.locator('.prose .image-zoom').first().click();
  const dialog = page.locator('dialog.lightbox');
  await expect(dialog).toBeVisible();
  // The dialog fades in; axe computes contrast through opacity, so a scan
  // mid-fade fails color-contrast on the caption. Scan the settled state.
  await expect.poll(() => dialog.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined))),
  );

  expect(summarize(await scan(page))).toEqual([]);
});
