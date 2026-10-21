#!/usr/bin/env node
// Generates the favicon set and brand marks from the shared mark renderer into
// public/favicon.ico, public/assets/icons/*, and public/assets/brand/*.
import fs from 'node:fs';
import path from 'node:path';
import { renderMarkSet, wordmarkSvg } from 'branding-engine';
import { BRAND } from '../src/lib/brand.ts';
import { SITE } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { cli } from './lib/args.ts';

cli({ usage: 'usage: node bin/make-icons.ts' });

const marks = await renderMarkSet({ hex: BRAND.navy, onColor: BRAND.onNavy, glyph: BRAND.glyph });

const outputs: Record<string, string | Buffer> = {
  'public/favicon.ico': marks.faviconIco,
  'public/assets/icons/favicon.svg': marks.faviconSvg,
  'public/assets/icons/apple-touch-icon.png': marks.appleTouchIcon,
  'public/assets/brand/mark.svg': marks.markSvg,
  'public/assets/brand/mark-512.png': marks.mark512,
  'public/assets/brand/mark-1024.png': marks.mark1024,
  'public/assets/brand/mark-1024-transparent.png': marks.markTransparent,
  // Inlined by Header.astro; text is currentColor so the header's hover color drives it.
  'public/assets/brand/wordmark-caps.svg': wordmarkSvg({ tileHex: BRAND.navy, text: SITE.owner, glyph: BRAND.glyph, caps: true }),
};

for (const [file, content] of Object.entries(outputs)) {
  fs.mkdirSync(path.dirname(fromRoot(file)), { recursive: true });
  fs.writeFileSync(fromRoot(file), content);
}

console.log(`Wrote ${Object.keys(outputs).join(', ')}`);
