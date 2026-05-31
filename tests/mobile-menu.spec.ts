import { test, expect } from '@playwright/test';

test('mobile menu opens via hamburger and closes on Escape', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('[data-nav-toggle]');
  const popover = page.locator('[data-mobile-nav]');

  await expect(toggle).toBeVisible();
  await expect(popover).toBeHidden();

  await toggle.click();
  await expect(popover).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
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
