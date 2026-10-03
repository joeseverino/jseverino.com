import { test, expect, type ConsoleMessage } from '@playwright/test';
import { anyWriteup } from './helpers/writeups.ts';

const turnstileFeaturePolicyWarnings = new Set([
  'autoplay',
  'cross-origin-isolated',
  'keyboard-map',
  'xr-spatial-tracking',
]);

function isKnownTurnstileWarning(message: ConsoleMessage): boolean {
  const text = message.text();
  const match = text.match(/Feature Policy: Skipping unsupported feature name [“"]([^"”]+)[”"]\./);
  const sourceUrl = message.location().url;
  const isTurnstileSource = sourceUrl.startsWith('https://challenges.cloudflare.com/turnstile/')
    || /^\[JavaScript Warning: ".+" \{file: "https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js" line: \d+\}\]$/.test(text);
  return message.type() === 'warning'
    && isTurnstileSource
    && match !== null
    && turnstileFeaturePolicyWarnings.has(match[1] ?? '');
}

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

test('representative routes emit no browser warnings or errors', async ({ page }) => {
  const diagnostics: string[] = [];
  page.on('pageerror', (err) => diagnostics.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (
      ['warning', 'error'].includes(msg.type())
      && !msg.text().startsWith('Failed to preconnect to ')
      && !isKnownTurnstileWarning(msg)
    ) {
      diagnostics.push(`${msg.type()}: ${msg.text()}`);
    }
  });
  for (const route of ['/', '/portfolio/', '/resume/', '/contact/']) {
    await page.goto(route, { waitUntil: 'load' });
    // Two frames past load: post-load handlers have run and painted.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
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
