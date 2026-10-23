#!/usr/bin/env node
// Generates the favicon set and brand marks from the shared mark renderer into
// public/favicon.ico, public/assets/icons/*, and public/assets/brand/*.
//
//   node bin/make-icons.ts           # (re)write every mark
//   node bin/make-icons.ts --check   # fail if a committed SVG differs from the renderer's
//
// --check compares the vector marks alone: the rasters differ by machine.
import fs from 'node:fs';
import { renderMarkSet, wordmarkSvg } from 'branding-engine';
import { BRAND } from '../src/lib/brand.ts';
import { SITE } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { checkMode } from './lib/args.ts';
import { writeOrCheck } from './lib/projection.ts';

const check = checkMode('usage: node bin/make-icons.ts [--check]');

const marks = await renderMarkSet({ hex: BRAND.navy, onColor: BRAND.onNavy, glyph: BRAND.glyph });

const vectors: Record<string, string> = {
  'public/assets/icons/favicon.svg': marks.faviconSvg,
  'public/assets/brand/mark.svg': marks.markSvg,
  // Inlined by Header.astro; text is currentColor so the header's hover color drives it.
  'public/assets/brand/wordmark-caps.svg': wordmarkSvg({ tileHex: BRAND.navy, text: SITE.owner, glyph: BRAND.glyph, caps: true }),
};

const rasters: Record<string, Buffer> = {
  'public/favicon.ico': marks.faviconIco,
  'public/assets/icons/apple-touch-icon.png': marks.appleTouchIcon,
  'public/assets/brand/mark-512.png': marks.mark512,
  'public/assets/brand/mark-1024.png': marks.mark1024,
  'public/assets/brand/mark-1024-transparent.png': marks.markTransparent,
};

writeOrCheck(
  Object.entries(vectors).map(([file, content]) => ({ file: fromRoot(file), content })),
  { check },
);
if (check) {
  console.log(`ok       ${Object.keys(vectors).join(', ')} match the mark renderer`);
} else {
  for (const [file, content] of Object.entries(rasters)) fs.writeFileSync(fromRoot(file), content);
  console.log(`wrote ${Object.keys(rasters).join(', ')}`);
}
