import { test, expect } from '@playwright/test';
import { anyWriteup } from './helpers/writeups';

// Include tablet and the narrowest supported phone, not only screenshot sizes.
for (const width of [320, 390, 768, 1440]) {
  test(`representative pages stay within a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/challenges.cloudflare.com/**', (route) => route.abort());
    for (const path of ['/', '/about/', '/portfolio/', '/portfolio/#software', '/resume/', '/contact/', '/education/', anyWriteup()]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const size = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
      expect(size.content, `${path} overflows at ${width}px`).toBeLessThanOrEqual(size.viewport + 1);
    }
  });
}
