import { test, expect } from '@playwright/test';
import { imageHeavyWriteup } from './writeups.ts';

// Guards the responsive-image pipeline: a broken AVIF/WebP/fallback variant would
// slip past the sitemap smoke test. Collects every image URL the page references
// (<img src/srcset> plus <picture><source srcset>, i.e. all the generated
// variants) and asserts each one resolves, so a missing variant fails the build.
// Engine-independent, so *.single.

const pages = ['/', imageHeavyWriteup()];

for (const path of pages) {
  test(`all image sources resolve on ${path}`, async ({ page, request }) => {
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const urls = await page.evaluate(() => {
      const found = new Set<string>();
      const addSrcset = (srcset: string | null) => {
        for (const part of (srcset || '').split(',')) {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) found.add(new URL(candidate, location.href).href);
        }
      };
      for (const img of document.querySelectorAll('img')) {
        if (img.getAttribute('src')) found.add(new URL(img.getAttribute('src')!, location.href).href);
        addSrcset(img.getAttribute('srcset'));
      }
      for (const source of document.querySelectorAll('picture source')) {
        addSrcset(source.getAttribute('srcset'));
      }
      return [...found];
    });

    expect(urls.length, `expected images on ${path}`).toBeGreaterThan(0);

    const broken: string[] = [];
    for (const url of urls) {
      const response = await request.get(url);
      if (response.status() >= 400) broken.push(`${response.status()} ${url}`);
    }
    expect(broken, `broken image sources on ${path}`).toEqual([]);
  });
}
