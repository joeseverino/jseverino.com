#!/usr/bin/env node

// Generates the 1200x630 Open Graph card at public/assets/og/og-default.jpg
// (PNG render re-encoded as JPEG, about 100 KB vs 850 KB).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { SITE } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { cli } from './lib/args.ts';
import { renderBrandCard } from './lib/brand-card.ts';

cli({ usage: 'usage: node bin/make-og-image.ts' });

using dir = fs.mkdtempDisposableSync(path.join(os.tmpdir(), 'og-default-'));
const render = path.join(dir.path, 'og-default.png');
await renderBrandCard({
  width: 1200,
  height: 630,
  photoWidth: 462,
  eyebrow: SITE.focus.join(' • '),
  name: SITE.owner,
  tagline: 'Hands-on security & infrastructure projects',
  meta: 'Technical Solutions Engineer • CCNA • Security+',
  url: SITE.domain,
  outPath: render,
});

await sharp(render).jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(fromRoot('public/assets/og/og-default.jpg'));

console.log('Wrote public/assets/og/og-default.jpg (1200x630)');
