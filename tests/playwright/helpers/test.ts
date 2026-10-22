// The `test` every browser spec imports in place of Playwright's own.
import { test as base, expect, type ConsoleMessage, type Page } from '@playwright/test';

export * from '@playwright/test';

const upgrade = /(?:^|;)\s*upgrade-insecure-requests\s*(?=;|$)/;

export const test = base.extend({
  // The preview serves production's CSP over plain http, and WebKit, unlike Chromium and
  // Firefox, upgrades localhost under upgrade-insecure-requests, so no subresource loads.
  // Production keeps the directive; WebKit's local pages drop it.
  context: async ({ context, browserName, baseURL }, use) => {
    if (browserName === 'webkit' && baseURL) {
      const origin = new URL(baseURL).origin;
      await context.route((url) => url.origin === origin, async (route) => {
        if (route.request().resourceType() !== 'document') return route.fallback();
        // Fetched with its redirects followed: Playwright cannot fulfill a redirect, and
        // WebKit keeps upgrading an origin once any of its documents asked it to.
        const response = await route.fetch();
        const headers = response.headers();
        const policy = headers['content-security-policy'];
        if (policy) headers['content-security-policy'] = policy.replace(upgrade, '');
        return route.fulfill({ response, headers });
      });
    }
    await use(context);
  },
});

// Readiness: fonts resolved and eager images decoded, instead of networkidle.
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((img) => img.loading !== 'lazy').every((img) => img.complete)))
    .toBe(true);
}

// Any route turns on Playwright's WebKit interception for every request, and that fails
// Turnstile's blob: load (shown on Turnstile's own demo page), so this error is the harness's.
export function isWebKitInterceptionBlobError(message: ConsoleMessage): boolean {
  return message.type() === 'error'
    && message.page()?.context().browser()?.browserType().name() === 'webkit'
    && message.location().url.startsWith('blob:https://challenges.cloudflare.com/')
    && message.text().includes('WebKitBlobResource error 1.');
}
