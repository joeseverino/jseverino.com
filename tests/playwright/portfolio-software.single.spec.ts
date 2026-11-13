import { expect, type Page, test } from './helpers/test.ts';

// The tab toggle is plain DOM plus a small script, so this runs chromium-only (.single).
// Asserts structure, not specific version numbers.

// A hidden panel is out of the accessibility tree, so the lookup reaches past it.
const panel = (page: Page, name: 'Writeups' | 'Software') => page.getByRole('tabpanel', { name, includeHidden: true });

test.describe('portfolio software tab', () => {
  test('tabs follow URL changes and preserve query parameters', async ({ page }) => {
    await page.goto('/portfolio/?source=review');
    await page.getByRole('tab', { name: 'Software' }).click();
    await expect(page).toHaveURL(/\?source=review#software$/);
    await page.evaluate(() => {
      window.location.hash = '';
    });
    await expect(page.getByRole('tab', { name: 'Writeups' })).toHaveAttribute('aria-selected', 'true');
    await page.goBack();
    await expect(page.getByRole('tab', { name: 'Software' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'Writeups' }).click();
    await expect(page).toHaveURL(/\?source=review$/);
  });

  test('keyboard navigation includes Home, End, and arrow wrapping', async ({ page }) => {
    await page.goto('/portfolio/');
    const writeups = page.getByRole('tab', { name: 'Writeups' });
    const software = page.getByRole('tab', { name: 'Software' });
    await writeups.focus();
    await page.keyboard.press('End');
    await expect(software).toBeFocused();
    await expect(software).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowRight');
    await expect(writeups).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(software).toBeFocused();
    await page.keyboard.press('Home');
    await expect(writeups).toBeFocused();
    await expect(writeups).toHaveAttribute('aria-selected', 'true');
  });
  test('repeated copies reset feedback after the latest click', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: async () => {} },
      });
    });
    await page.goto('/portfolio/#software');
    await page.clock.install();
    const button = page.getByRole('button', { name: /^Copy command/ }).first();
    await button.click();
    await expect(button).toHaveText('Copied');
    await page.clock.runFor(1000);
    await button.click();
    await page.clock.runFor(500);
    await expect(button).toHaveText('Copied');
    await page.clock.runFor(1000);
    await expect(button).toHaveText('Copy');
    await expect(button).not.toHaveClass(/is-copied/);
  });
  test.describe('without JavaScript', () => {
    test.use({ javaScriptEnabled: false });

    // Without the script the panels are plain sections, so each is found by what it holds.
    test('both panels are in the markup and shown', async ({ page }) => {
      await page.goto('/portfolio/');
      await expect(page.getByText('Browse by technology')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'More projects' })).toBeVisible();
    });
  });

  test('defaults to Writeups; Software is hidden until selected', async ({ page }) => {
    await page.goto('/portfolio/');
    await expect(panel(page, 'Writeups')).toBeVisible();
    await expect(panel(page, 'Software')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Writeups' })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Software shows its panel in place of Writeups', async ({ page }) => {
    await page.goto('/portfolio/');
    await page.getByRole('tab', { name: 'Software' }).click();

    await expect(panel(page, 'Software')).toBeVisible();
    await expect(panel(page, 'Writeups')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Software' })).toHaveAttribute('aria-selected', 'true');
  });

  test('deep-links to the Software tab via #software', async ({ page }) => {
    await page.goto('/portfolio/#software');
    await expect(panel(page, 'Software')).toBeVisible();
    await expect(panel(page, 'Writeups')).toBeHidden();
  });

  test('a published package renders a registry badge, install line, and copy button', async ({ page }) => {
    await page.goto('/portfolio/#software');
    const card = panel(page, 'Software')
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: 'sitedrift' }) });
    await expect(card).toBeVisible();
    await expect(card.getByText(/^npm( v\S+)?$/)).toBeVisible();
    await expect(card.getByRole('code')).toContainText('npm i sitedrift');

    const copy = card.getByRole('button', { name: 'Copy command: npm i sitedrift' });
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAttribute('data-copy', 'npm i sitedrift');
  });

  test('the "More projects" list has an entry', async ({ page }) => {
    await page.goto('/portfolio/#software');
    const more = panel(page, 'Software')
      .getByRole('list')
      .filter({ has: page.getByRole('heading', { level: 3 }) });
    await expect(more.getByRole('listitem')).not.toHaveCount(0);
  });

  test('software writeup cross-links resolve to a writeup page', async ({ page }) => {
    await page.goto('/portfolio/#software');
    const link = panel(page, 'Software')
      .getByRole('link', { name: /writeup/i })
      .first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/portfolio\/[a-z0-9-]+\/$/);
    const response = await page.request.get(href ?? '');
    expect(response.status()).toBe(200);
  });
});
