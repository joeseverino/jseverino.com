// Shared social-card renderer. Both make-og-image and make-github-social build a
// "text panel + photo" card; this renders it in real Inter via headless Chromium
// (full-text Inter is beyond the glyph-outline pipeline used for the mark).
//
// Colours come from the canonical src/lib/brand.mjs. The Inter woff2 is embedded
// as a data URI so the render is self-contained.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { BRAND } from '../../src/lib/brand.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const fontB64 = readFileSync(
  path.join(root, 'public/assets/fonts/inter/inter-variable-latin.woff2')
).toString('base64');

const esc = (s) => s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/**
 * Render a card to a PNG.
 * @param {object} o  width, height, photoWidth, eyebrow, name, tagline, meta, url, photoPath, outPath
 */
export async function renderCard(o) {
  const photoB64 = readFileSync(o.photoPath).toString('base64');
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;font-weight:200 900;font-display:block;src:url(data:font/woff2;base64,${fontB64}) format('woff2')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${o.width}px;height:${o.height}px}
body{display:flex;font-family:Inter,sans-serif;overflow:hidden;-webkit-font-smoothing:antialiased}
.panel{width:${o.width - o.photoWidth}px;height:${o.height}px;
  background:linear-gradient(135deg,${BRAND.navy},#14245C);
  padding:72px;display:flex;flex-direction:column;justify-content:center;color:#fff}
.eyebrow{font-size:24px;font-weight:600;letter-spacing:3.5px;color:#A9C0E8;text-transform:uppercase}
.name{font-size:78px;font-weight:800;letter-spacing:-2px;line-height:1.05;margin-top:18px}
.rule{width:64px;height:5px;border-radius:2.5px;background:#5B82D6;margin-top:26px}
.tagline{font-size:30px;font-weight:400;color:#DDE6FB;margin-top:30px}
.meta{font-size:24px;font-weight:600;letter-spacing:.5px;color:#A9C0E8;margin-top:14px}
.url{font-size:25px;font-weight:600;letter-spacing:.5px;color:#A9C0E8;margin-top:34px}
.photo{width:${o.photoWidth}px;height:${o.height}px;object-fit:cover;object-position:top}
</style></head><body>
<div class="panel">
  <div class="eyebrow">${esc(o.eyebrow)}</div>
  <div class="name">${esc(o.name)}</div>
  <div class="rule"></div>
  <div class="tagline">${esc(o.tagline)}</div>
  <div class="meta">${esc(o.meta)}</div>
  <div class="url">${esc(o.url)}</div>
</div>
<img class="photo" src="data:image/jpeg;base64,${photoB64}">
</body></html>`;

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(async () => { await document.fonts.ready; });
  const shot = await page.screenshot({ type: 'png' });
  await browser.close();
  // Rendered at 2x for crisp text; downscale to the exact card size.
  await sharp(shot).resize(o.width, o.height).png().toFile(o.outPath);
}
