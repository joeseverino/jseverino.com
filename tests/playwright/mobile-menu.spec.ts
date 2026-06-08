import { test, expect } from '@playwright/test';

test('touch targets suppress title-only tap highlights', async ({ page, browserName }) => {
  test.skip(browserName === 'firefox', 'Firefox does not implement -webkit-tap-highlight-color.');

  await page.goto('/portfolio/');

  const brand = page.locator('.brand');
  const cardLinks = page.locator('.project-card a');

  await expect(brand).toHaveCSS('-webkit-tap-highlight-color', 'rgba(0, 0, 0, 0)');
  await expect(cardLinks.first()).toHaveCSS(
    '-webkit-tap-highlight-color',
    'rgba(0, 0, 0, 0)',
  );
});

test('mobile menu opens via hamburger and closes on Escape', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('[data-nav-toggle]');
  const popover = page.locator('[data-mobile-nav]');

  await expect(toggle).toBeVisible();
  await expect(popover).toBeHidden();

  await toggle.click();
  await expect(popover).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('mobile menu closes after navigating via a menu link', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('[data-nav-toggle]');
  const popover = page.locator('[data-mobile-nav]');

  await toggle.click();
  await expect(popover).toBeVisible();

  await popover.getByRole('link', { name: /portfolio/i }).first().click();
  await expect(page).toHaveURL(/\/portfolio\/$/);
  await expect(popover).toBeHidden();
});
