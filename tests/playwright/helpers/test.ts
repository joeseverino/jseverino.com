// The `test` every browser spec imports in place of Playwright's own.
import { type APIRequestContext, test as base, type ConsoleMessage, expect, type Locator, type Page } from '@playwright/test';
import { TURNSTILE_ORIGIN } from '../../../src/lib/csp.ts';
import { sitemapUrls } from '../../../src/lib/sitemap.ts';

export * from '@playwright/test';

const upgrade = /(?:^|;)\s*upgrade-insecure-requests\s*(?=;|$)/;

export const test = base.extend({
  // The preview serves production's CSP over plain http, and WebKit, unlike Chromium and
  // Firefox, upgrades localhost under upgrade-insecure-requests, so no subresource loads.
  // Production keeps the directive; WebKit's local pages drop it.
  context: async ({ context, browserName, baseURL }, use) => {
    if (browserName === 'webkit' && baseURL) {
      const origin = new URL(baseURL).origin;
      await context.route(
        (url) => url.origin === origin,
        async (route) => {
          if (route.request().resourceType() !== 'document') return route.fallback();
          // Fetched with its redirects followed: Playwright cannot fulfill a redirect, and
          // WebKit keeps upgrading an origin once any of its documents asked it to.
          const response = await route.fetch();
          const headers = response.headers();
          const policy = headers['content-security-policy'];
          if (policy) headers['content-security-policy'] = policy.replace(upgrade, '');
          return route.fulfill({ response, headers });
        },
      );
    }
    await use(context);
  },
});

// Readiness: fonts resolved and eager images decoded, instead of networkidle.
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect.poll(() => page.evaluate(() => [...document.images].filter((img) => img.loading !== 'lazy').every((img) => img.complete))).toBe(true);
}

// Any route turns on Playwright's WebKit interception for every request, and that fails
// Turnstile's blob: load (shown on Turnstile's own demo page), so this error is the harness's.
// macOS WebKit reports the cause and Linux WebKit only that the load failed.
export function isWebKitInterceptionBlobError(message: ConsoleMessage): boolean {
  const text = message.text();
  return (
    message.type() === 'error' &&
    message.page()?.context().browser()?.browserType().name() === 'webkit' &&
    message.location().url.startsWith('blob:https://challenges.cloudflare.com/') &&
    (text.includes('WebKitBlobResource error 1.') || text === 'Failed to load resource')
  );
}

// Turnstile's always-pass test key solves the challenge on its own schedule, and its script
// keeps the network busy and resizes the widget, so a spec that does not test the
// challenge aborts every request to it.
export const withoutTurnstile = (page: Page) => page.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.abort());

// A locator's bounding box, which Playwright gives as null for an element that is
// not rendered; a spec that measures one fails on that here, by the element's name.
export async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${locator} has no box: it is not rendered`);
  return box;
}

// Every page the sitemap lists, as a path on the server under test, since each <loc>
// names the canonical origin. Each sitemap file it reads must answer 200.
export async function sitemapPaths(request: APIRequestContext): Promise<string[]> {
  const pathOf = (url: string) => (url.startsWith('/') ? url : new URL(url).pathname);
  const urls = await sitemapUrls('/sitemap-index.xml', async (url) => {
    const response = await request.get(pathOf(url));
    expect(response.status(), `expected 200 from ${pathOf(url)}`).toBe(200);
    return response.text();
  });
  expect(urls, 'the sitemap lists no page').not.toHaveLength(0);
  return urls.map(pathOf);
}
