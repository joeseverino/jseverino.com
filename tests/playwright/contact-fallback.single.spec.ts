import { site } from '../../src/lib/site.ts';
import { expect, type Page, test } from './helpers/test.ts';

// The form ships hidden, so both lookups reach past the accessibility tree.
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send Message', includeHidden: true });
const fallbackLink = (page: Page) => page.getByRole('link', { name: 'get in touch on LinkedIn', includeHidden: true });

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('contact remains usable', async ({ page }) => {
    await page.goto('/contact/');
    await expect(sendButton(page)).toBeHidden();
    await expect(fallbackLink(page)).toBeVisible();
    await expect(fallbackLink(page)).toHaveAttribute('href', site.socialLinks.find((link) => link.icon === 'linkedin')?.href ?? '');
  });
});

test('a blocked submission script preserves the contact fallback', async ({ page }) => {
  await page.route('**/_astro/*.js', (route) => route.abort());
  await page.goto('/contact/');
  await expect(sendButton(page)).toBeHidden();
  await expect(fallbackLink(page)).toBeVisible();
});

test('the fallback stays hidden while the form module loads', async ({ page }) => {
  const loading = Promise.withResolvers<void>();
  await page.route('**/_astro/*.js', async (route) => {
    await loading.promise;
    await route.continue();
  });
  try {
    await page.goto('/contact/', { waitUntil: 'commit' });
    await expect(fallbackLink(page)).toBeAttached();
    await expect(fallbackLink(page)).toHaveCSS('visibility', 'hidden');
    await expect(sendButton(page)).toBeHidden();
  } finally {
    loading.resolve();
  }
  await expect(sendButton(page)).toBeVisible();
  await expect(fallbackLink(page)).toBeHidden();
});
