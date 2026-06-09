import { test, expect } from '@playwright/test';

// Endpoint and error routes that the sitemap-driven smoke test cannot reach.
// Named *.single so the config runs them only on chromium-desktop: the responses
// are engine-independent, so there is no value in the full browser matrix.

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
