import { test, expect } from '@playwright/test';

// Functional coverage for the Software tab of /portfolio. The tab toggle is
// plain DOM + a small script (engine-independent), so this runs chromium-only
// (.single). The data itself is build-time derived (GitHub + PyPI/npm); these
// assertions pin behaviour and structure, not specific version numbers.

test.describe('portfolio software tab', () => {
  test('both panels render in the DOM (no-JS / SEO)', async ({ page }) => {
    await page.goto('/portfolio/');
    // Present in the markup regardless of which tab the script activates.
    await expect(page.locator('[data-panel="writeups"]')).toHaveCount(1);
    await expect(page.locator('[data-panel="software"]')).toHaveCount(1);
  });

  test('defaults to Writeups; Software is hidden until selected', async ({ page }) => {
    await page.goto('/portfolio/');
    await expect(page.locator('[data-panel="writeups"]')).toBeVisible();
    await expect(page.locator('[data-panel="software"]')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Writeups' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('clicking Software swaps panels and updates the hash', async ({ page }) => {
    await page.goto('/portfolio/');
    await page.getByRole('tab', { name: 'Software' }).click();

    await expect(page.locator('[data-panel="software"]')).toBeVisible();
    await expect(page.locator('[data-panel="writeups"]')).toBeHidden();
    await expect(page.getByRole('tab', { name: 'Software' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page).toHaveURL(/#software$/);
  });

  test('deep-links to the Software tab via #software', async ({ page }) => {
    await page.goto('/portfolio/#software');
    await expect(page.locator('[data-panel="software"]')).toBeVisible();
    await expect(page.locator('[data-panel="writeups"]')).toBeHidden();
  });

  test('a published package renders a registry badge, install line, and copy button', async ({
    page,
  }) => {
    await page.goto('/portfolio/#software');
    const panel = page.locator('[data-panel="software"]');

    const card = panel.locator('.software-card', {
      has: page.getByRole('heading', { name: 'severino-vault-engine' }),
    });
    await expect(card).toBeVisible();
    await expect(card.locator('.badge--pypi')).toContainText('PyPI');
    await expect(card.locator('.software-install-cmd')).toContainText(
      'pip install severino-vault-engine',
    );

    const copy = card.locator('.software-copy');
    await expect(copy).toBeVisible();
    await expect(copy).toHaveAttribute('data-copy', 'pip install severino-vault-engine');
  });

  test('renders the "More projects" compact list', async ({ page }) => {
    await page.goto('/portfolio/#software');
    const list = page.locator('[data-panel="software"] .software-list .sli');
    expect(await list.count()).toBeGreaterThan(0);
  });

  test('software writeup cross-links resolve to a writeup page', async ({ page }) => {
    await page.goto('/portfolio/#software');
    const link = page
      .locator('[data-panel="software"]')
      .getByRole('link', { name: /writeup/i })
      .first();
    await expect(link).toBeVisible();

    const href = await link.getAttribute('href');
    expect(href).toMatch(/^\/portfolio\/[a-z0-9-]+\/$/);
    const response = await page.request.get(href!);
    expect(response.status()).toBe(200);
  });
});
