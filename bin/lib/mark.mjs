// Builds the brand mark SVG from real Inter (weight 800) glyph outlines, so every
// generated asset (favicon, OG card, social) shares one consistent mark.
//
// Colours + glyph come from the canonical src/lib/brand.mjs. Outlines are extracted
// into inter-glyphs.json by extract-glyphs.py — re-run that if the glyph or weight
// changes. The render params below control how the mark is composed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BRAND } from '../../src/lib/brand.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const glyphData = JSON.parse(readFileSync(path.join(here, 'inter-glyphs.json'), 'utf8'));

const RENDER = {
  letterSpacing: -0.045, // em
  widthRatio: 0.63,      // glyph ink width relative to the box
  radiusRatio: 0.22,     // rounded-square corner radius (0 = square)
};

// Lay the glyph string out in font units and measure the combined ink box.
function layout() {
  const { unitsPerEm, glyphs } = glyphData;
  const ls = RENDER.letterSpacing * unitsPerEm;
  const chars = [...BRAND.glyph];
  let penX = 0;
  const placed = [];
  chars.forEach((ch, i) => {
    const g = glyphs[ch];
    placed.push({ x: penX, g });
    penX += g.advance + (i < chars.length - 1 ? ls : 0);
  });
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const { x, g } of placed) {
    xMin = Math.min(xMin, x + g.bounds.xMin);
    xMax = Math.max(xMax, x + g.bounds.xMax);
    yMin = Math.min(yMin, g.bounds.yMin);
    yMax = Math.max(yMax, g.bounds.yMax);
  }
  return { placed, cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2, gw: xMax - xMin };
}

/**
 * Build the brand mark as a self-contained SVG string.
 * @param {object} opts
 * @param {number} [opts.size=512]      square canvas size
 * @param {boolean} [opts.rounded=true] rounded-square (false = full square)
 * @param {string|null} [opts.bg]       background fill, or null for transparent
 * @param {string} [opts.fg]            glyph fill (default: white on a bg, navy when transparent)
 */
export function markSvg({ size = 512, rounded = true, bg = BRAND.navy, fg } = {}) {
  const { placed, cx, cy, gw } = layout();
  const s = (RENDER.widthRatio * size) / gw;
  const rx = rounded ? +(size * RENDER.radiusRatio).toFixed(2) : 0;
  const glyphFill = fg || (bg ? BRAND.onNavy : BRAND.navy);
  const bgRect = bg ? `<rect width="${size}" height="${size}" rx="${rx}" fill="${bg}"/>` : '';
  const paths = placed
    .map(({ x, g }) => `<path transform="translate(${x.toFixed(2)} 0)" d="${g.path}"/>`)
    .join('');
  // Glyph outlines are y-up (font space); flip and centre them in the canvas.
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`
    + bgRect
    + `<g fill="${glyphFill}" transform="translate(${size / 2} ${size / 2}) scale(${s.toFixed(5)} ${(-s).toFixed(5)}) translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})">${paths}</g>`
    + `</svg>`;
}

export { BRAND };
