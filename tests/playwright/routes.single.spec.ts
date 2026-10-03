import { test, expect } from '@playwright/test';
import { sitemapUrls } from '../../src/lib/sitemap.ts';

// Route-level responses: every sitemap page, plus the endpoint and error routes
// the sitemap cannot reach. Named *.single so the config runs them only on
// chromium-desktop: the responses are engine-independent.

test('robots.txt serves plain text and points at the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/plain');

  const body = await response.text();
  expect(body).toContain('User-agent: *');
  expect(body).toContain('Sitemap: https://jseverino.com/sitemap-index.xml');
});

test('feed.xml serves valid RSS with at least one item', async ({ request }) => {
  const response = await request.get('/feed.xml');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('xml');

  const body = await response.text();
  expect(body).toContain('<rss');
  expect(body).toContain('<channel>');
  expect(body).toMatch(/<item>[\s\S]*?<\/item>/);
});

test('an unknown route returns 404 and renders the not-found page', async ({ page }) => {
  const response = await page.goto('/this-route-does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.locator('h1')).toHaveText('Page Not Found');
  await expect(page.getByRole('link', { name: 'View Portfolio' })).toBeVisible();
});

test('every sitemap page returns 200', async ({ request }) => {
  // <loc>s name the canonical origin; read each from the server under test.
  const urls = await sitemapUrls('/sitemap-index.xml', async (url) => {
    const pathname = url.startsWith('/') ? url : new URL(url).pathname;
    const response = await request.get(pathname);
    expect(response.status(), `expected 200 from ${pathname}`).toBe(200);
    return response.text();
  });
  const publicPaths = urls.map((url) => new URL(url).pathname);

  expect(publicPaths.length).toBeGreaterThan(0);
  for (const path of publicPaths) {
    const response = await request.get(path);
    expect(response.status(), `expected 200 from ${path}`).toBe(200);
  }
});
