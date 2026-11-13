import { builtSitemapPaths, expect, test, withoutTurnstile } from './helpers/test.ts';

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

const widths = [320, 390, 768, 1440];

// Every sitemap page, plus the software tab its hash opens, at the narrowest supported phone,
// tablet and desktop: no page scrolls sideways, and every table either fits its box or scrolls
// inside it, with no token in a cell broken to fit. One test per page keeps each test's cost
// flat as the site grows. The layout is CSS alone (no script reads the viewport), so one load
// resized through the widths lays out as a load at each would.
for (const path of [...(await builtSitemapPaths()), '/portfolio/#software']) {
  test(`${path} stays within the viewport at every supported width`, async ({ page }) => {
    await withoutTurnstile(page);
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.evaluate(measureLayout);
      expect.soft(layout.content, `${path} overflows at ${width}px`).toBeLessThanOrEqual(layout.viewport + 1);
      layout.tables.forEach((table, index) => {
        expect.soft(table.fits || table.scrolls, `${path} table ${index + 1} is cut off at ${width}px`).toBe(true);
        expect.soft(table.broken, `${path} table ${index + 1} breaks tokens at ${width}px`).toEqual([]);
      });
    }
  });
}
