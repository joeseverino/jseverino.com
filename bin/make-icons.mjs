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
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { markSvg } from 'branding-engine';
import { BRAND } from '../src/lib/brand.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = path.join(root, 'public/assets/icons');
const brandDir = path.join(root, 'public/assets/brand');

// The engine's mark is generic, so pass our identity explicitly: navy badge with
// a white glyph; the transparent variant uses the navy glyph (visible on light).
const badge = { glyph: BRAND.glyph, bg: BRAND.navy, fg: BRAND.onNavy };
const rounded = markSvg({ size: 512, rounded: true, ...badge });
const square = markSvg({ size: 512, rounded: false, ...badge });
const transparent = markSvg({ size: 1024, rounded: true, bg: null, fg: BRAND.navy, glyph: BRAND.glyph });

const png = (svg, size) => sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();

// Minimal, dependency-free PNG-based .ico encoder.
function pngsToIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, buffer } of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size >= 256 ? 0 : size, 0);
    e.writeUInt8(size >= 256 ? 0 : size, 1);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buffer.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buffer.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.buffer)]);
}

fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(brandDir, { recursive: true });

// Scalable favicon + brand mark (real Inter outlines, self-contained).
fs.writeFileSync(path.join(iconsDir, 'favicon.svg'), markSvg({ size: 64, rounded: true, ...badge }));
fs.writeFileSync(path.join(brandDir, 'mark.svg'), markSvg({ size: 512, rounded: true, ...badge }));

// Favicon raster set.
fs.writeFileSync(path.join(iconsDir, 'favicon-32.png'), await png(rounded, 32));
fs.writeFileSync(path.join(iconsDir, 'favicon-192.png'), await png(rounded, 192));
// iOS masks the touch icon itself, so ship a full-bleed square.
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), await png(square, 180));

// HD brand marks for reuse beyond the favicon.
fs.writeFileSync(path.join(brandDir, 'mark-512.png'), await png(rounded, 512));
fs.writeFileSync(path.join(brandDir, 'mark-1024.png'), await png(rounded, 1024));
fs.writeFileSync(path.join(brandDir, 'mark-1024-transparent.png'), await png(transparent, 1024));

// Root favicon.ico (16 + 32).
const ico = pngsToIco([
  { size: 16, buffer: await png(rounded, 16) },
  { size: 32, buffer: await png(rounded, 32) },
]);
fs.writeFileSync(path.join(root, 'public/favicon.ico'), ico);

console.log('Wrote favicon set + HD brand marks (favicon.ico/svg, 32/192, apple-touch, mark.svg + 512/1024).');
