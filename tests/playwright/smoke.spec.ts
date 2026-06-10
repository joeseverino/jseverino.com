import { test, expect } from '@playwright/test';
import { anyWriteup } from './writeups.ts';

test('home page loads with hero heading', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/Joe Severino/);
  const heroHeading = page.getByRole('heading', { level: 1 }).first();
  await expect(heroHeading).toBeVisible();
  await expect(heroHeading).toContainText(/Joe Severino/i);
});

test('primary navigation links resolve', async ({ page }) => {
  await page.goto('/');
  const portfolioLink = page.locator('.primary-nav').getByRole('link', { name: /portfolio/i }).first();
  await portfolioLink.click();
  await expect(page).toHaveURL(/\/portfolio\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/portfolio/i);
});

test('writeup page renders article and prose body', async ({ page }) => {
  await page.goto(anyWriteup());
  await expect(page.locator('.article-title')).toBeVisible();
  await expect(page.locator('.prose h2').first()).toBeVisible();
  await expect(page.locator('.prose')).not.toBeEmpty();
});

test('every sitemap page returns 200', async ({ request }) => {
  const indexResponse = await request.get('/sitemap-index.xml');
  expect(indexResponse.status()).toBe(200);

  const sitemapUrls = [...(await indexResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => new URL(match[1]).pathname);
  expect(sitemapUrls.length).toBeGreaterThan(0);

  const publicPaths: string[] = [];
  for (const sitemapUrl of sitemapUrls) {
    const sitemapResponse = await request.get(sitemapUrl);
    expect(sitemapResponse.status(), `expected 200 from ${sitemapUrl}`).toBe(200);
    publicPaths.push(
      ...[...(await sitemapResponse.text()).matchAll(/<loc>([^<]+)<\/loc>/g)]
        .map((match) => new URL(match[1]).pathname),
    );
  }

  expect(publicPaths.length).toBeGreaterThan(0);
  for (const path of publicPaths) {
    const response = await request.get(path);
    expect(response.status(), `expected 200 from ${path}`).toBe(200);
  }
});

test('no console errors on home', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to preconnect to ')) {
      errors.push(msg.text());
    }
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  expect(errors, errors.join('\n')).toHaveLength(0);
});

test('sticky header gains a shadow after scrolling', async ({ page }) => {
  await page.goto('/portfolio/');
  await page.evaluate(() => window.scrollTo(0, 200));

  await expect
    .poll(() => page.locator('.site-header').evaluate((header) => getComputedStyle(header, '::before').boxShadow))
    .not.toBe('none');
});
