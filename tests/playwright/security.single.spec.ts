import { test, expect } from '@playwright/test';

// Any link that opens a new tab must carry rel="noopener" so the opened page
// cannot reach back through window.opener. Engine-independent, so *.single.

const pages = ['/', '/about/', '/portfolio/', '/resume/'];

for (const path of pages) {
  test(`new-tab links on ${path} are rel=noopener safe`, async ({ page }) => {
    await page.goto(path);
    const unsafe = await page.locator('a[target="_blank"]').evaluateAll((links) =>
      links
        .filter((link) => !((link as HTMLAnchorElement).rel || '').includes('noopener'))
        .map((link) => (link as HTMLAnchorElement).href),
    );
    expect(unsafe, `target="_blank" links missing rel="noopener" on ${path}`).toEqual([]);
  });
}
