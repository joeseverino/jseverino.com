import { test, expect } from '@playwright/test';
import { anyWriteup } from './helpers/writeups.ts';

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

test('representative routes emit no browser warnings or errors', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('pageerror', (err) => diagnostics.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (['warning', 'error'].includes(msg.type()) && !msg.text().startsWith('Failed to preconnect to ')) {
      diagnostics.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  for (const route of ['/', '/portfolio/', '/resume/', '/contact/']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
  }
  expect(diagnostics, diagnostics.join('\n')).toHaveLength(0);
});

test('sticky header gains a shadow after scrolling', async ({ page }) => {
  await page.goto('/portfolio/');
  await page.evaluate(() => window.scrollTo(0, 200));

  await expect
    .poll(() => page.locator('.site-header').evaluate((header) => getComputedStyle(header, '::before').boxShadow))
    .not.toBe('none');
});
