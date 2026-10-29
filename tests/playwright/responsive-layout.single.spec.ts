import { sitemapUrls } from '../../src/lib/sitemap.ts';
import { expect, test } from './helpers/test.ts';

// Runs in the page: the document's width, and for each table box whether its table fits or
// scrolls, and the tokens (runs between spaces and dashes: a name, an address, a path) it
// draws on more than one line.
function measureLayout() {
  const range = document.createRange();
  const lines = () => new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  const brokenTokens = (box: Element): string[] => {
    const broken: string[] = [];
    const texts = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      // Text drawn on one line breaks nothing, so only wrapped text is measured token by token.
      range.selectNodeContents(node);
      if (lines() < 2) continue;
      for (const token of node.textContent?.matchAll(/[^\s\-–—]+/g) ?? []) {
        range.setStart(node, token.index);
        range.setEnd(node, token.index + token[0].length);
        if (lines() > 1) broken.push(token[0]);
      }
    }
    return broken;
  };
  return {
    content: document.documentElement.scrollWidth,
    viewport: document.documentElement.clientWidth,
    tables: [...document.querySelectorAll<HTMLElement>('.table-box')].map((box) => ({
      broken: brokenTokens(box),
      fits: (box.querySelector('table')?.offsetWidth ?? 0) <= box.clientWidth,
      scrolls: ['auto', 'scroll'].includes(getComputedStyle(box).overflowX),
    })),
  };
}

// Every sitemap page, plus the software tab its hash opens, at the narrowest supported phone,
// tablet and desktop: no page scrolls sideways, and every table either fits its box or scrolls
// inside it, with no token in a cell broken to fit.
for (const width of [320, 390, 768, 1440]) {
  test(`every page stays within a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/challenges.cloudflare.com/**', (route) => route.abort());
    // <loc>s name the canonical origin; read each from the server under test.
    const pathOf = (url: string) => (url.startsWith('/') ? url : new URL(url).pathname);
    const urls = await sitemapUrls('/sitemap-index.xml', async (url) => (await page.request.get(pathOf(url))).text());
    const paths = [...urls.map(pathOf), '/portfolio/#software'];

    for (const path of paths) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      const layout = await page.evaluate(measureLayout);
      expect(layout.content, `${path} overflows at ${width}px`).toBeLessThanOrEqual(layout.viewport + 1);
      layout.tables.forEach((table, index) => {
        expect(table.fits || table.scrolls, `${path} table ${index + 1} is cut off at ${width}px`).toBe(true);
        expect(table.broken, `${path} table ${index + 1} breaks tokens at ${width}px`).toEqual([]);
      });
    }
  });
}
