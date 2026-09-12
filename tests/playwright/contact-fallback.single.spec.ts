import { test, expect } from '@playwright/test';

test('contact remains usable without JavaScript', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  try {
    await page.goto('/contact/');
    await expect(page.locator('.contact-intake-form')).toBeHidden();
    await expect(page.locator('.contact-fallback a')).toBeVisible();
    await expect(page.locator('.contact-fallback a')).toHaveAttribute('href', 'https://linkedin.com/in/joeseverino/');
  } finally {
    await context.close();
  }
});

test('a blocked submission script preserves the contact fallback', async ({ page }) => {
  await page.route('**/_astro/*.js', (route) => route.abort());
  await page.goto('/contact/');
  await expect(page.locator('.contact-intake-form')).toBeHidden();
  await expect(page.locator('.contact-fallback a')).toBeVisible();
});
