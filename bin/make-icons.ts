// Generates the favicon set and brand marks from the shared mark renderer: node bin/make-icons.ts
// Writes public/favicon.ico, public/assets/icons/*, and public/assets/brand/*.
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkSet, wordmarkSvg } from 'branding-engine';
import { BRAND } from '../src/lib/brand.ts';
import { SITE } from '../src/lib/site-config.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';

const iconsDir = path.join(root, 'public/assets/icons');
const brandDir = path.join(root, 'public/assets/brand');

const badge = { glyph: BRAND.glyph, bg: BRAND.navy, fg: BRAND.onNavy };
const rendered = await renderMarkSet({ hex: badge.bg, onColor: badge.fg, glyph: badge.glyph });

fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(brandDir, { recursive: true });

fs.writeFileSync(path.join(iconsDir, 'favicon.svg'), rendered.faviconSvg);
fs.writeFileSync(path.join(brandDir, 'mark.svg'), rendered.markSvg);

// Inlined by Header.astro; text is currentColor so the header's hover color drives it.
fs.writeFileSync(
  path.join(brandDir, 'wordmark-caps.svg'),
  wordmarkSvg({ tileHex: BRAND.navy, text: SITE.owner, glyph: BRAND.glyph, caps: true }),
);

fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), rendered.appleTouchIcon);

fs.writeFileSync(path.join(brandDir, 'mark-512.png'), rendered.mark512);
fs.writeFileSync(path.join(brandDir, 'mark-1024.png'), rendered.mark1024);
fs.writeFileSync(path.join(brandDir, 'mark-1024-transparent.png'), rendered.markTransparent);

fs.writeFileSync(path.join(root, 'public/favicon.ico'), rendered.faviconIco);

console.log('Wrote favicon set + HD brand marks (favicon.ico/svg, apple-touch, mark.svg + 512/1024, wordmark-caps.svg).');
