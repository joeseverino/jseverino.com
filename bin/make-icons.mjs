// Generates the favicon set and HD brand marks from the shared mark renderer.
// Run with: node bin/make-icons.mjs
//
// Outputs:
//   public/favicon.ico                          (16 + 32: clients that probe the root)
//   public/assets/icons/favicon.svg             (scalable primary, real Inter outlines)
//   public/assets/icons/favicon-32.png
//   public/assets/icons/favicon-192.png
//   public/assets/icons/apple-touch-icon.png    (180, full-bleed square for iOS masking)
//   public/assets/brand/mark.svg                (scalable brand mark, navy badge)
//   public/assets/brand/mark-512.png  mark-1024.png
//   public/assets/brand/mark-1024-transparent.png  (navy glyph, no background)
//   public/assets/brand/wordmark-caps.svg       (tile + name lockup, currentColor text)
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkSet, wordmarkSvg } from 'branding-engine';
import { BRAND } from '../src/lib/brand.mjs';
import { SITE } from '../src/lib/site-config.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const root = siteRoot;
const iconsDir = path.join(root, 'public/assets/icons');
const brandDir = path.join(root, 'public/assets/brand');

// The engine's mark is generic, so pass our identity explicitly: navy badge with
// a white glyph; the transparent variant uses the navy glyph (visible on light).
const badge = { glyph: BRAND.glyph, bg: BRAND.navy, fg: BRAND.onNavy };
const rendered = await renderMarkSet({ hex: badge.bg, onColor: badge.fg, glyph: badge.glyph });

fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(brandDir, { recursive: true });

// Scalable favicon + brand mark (real Inter outlines, self-contained).
fs.writeFileSync(path.join(iconsDir, 'favicon.svg'), rendered.faviconSvg);
fs.writeFileSync(path.join(brandDir, 'mark.svg'), rendered.markSvg);

// Header lockup: navy tile + caps name, text in currentColor so the header's
// hover/active color drives it. Inlined by Header.astro, not loaded as an image.
// SITE.owner is the same name the header reads, so the wordmark can't drift.
fs.writeFileSync(
  path.join(brandDir, 'wordmark-caps.svg'),
  wordmarkSvg({ tileHex: BRAND.navy, text: SITE.owner, glyph: BRAND.glyph, caps: true }),
);

// Favicon raster set.
fs.writeFileSync(path.join(iconsDir, 'favicon-32.png'), rendered.favicon32);
fs.writeFileSync(path.join(iconsDir, 'favicon-192.png'), rendered.favicon192);
// iOS masks the touch icon itself, so ship a full-bleed square.
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), rendered.appleTouchIcon);

// HD brand marks for reuse beyond the favicon.
fs.writeFileSync(path.join(brandDir, 'mark-512.png'), rendered.mark512);
fs.writeFileSync(path.join(brandDir, 'mark-1024.png'), rendered.mark1024);
fs.writeFileSync(path.join(brandDir, 'mark-1024-transparent.png'), rendered.markTransparent);

// Root favicon.ico (16 + 32).
fs.writeFileSync(path.join(root, 'public/favicon.ico'), rendered.faviconIco);

console.log('Wrote favicon set + HD brand marks (favicon.ico/svg, 32/192, apple-touch, mark.svg + 512/1024, wordmark-caps.svg).');
