// Generates the 1200x630 Open Graph social card at public/assets/og/og-default.jpg:
// rendered once as a PNG, then encoded as a JPEG (about 100 KB against 850 KB), the
// format every platform reads and the one content cards already use.
// Run with: node bin/make-og-image.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { renderCard, launchBrowser } from 'branding-engine';
import { brandCardColors } from '../src/lib/brand.ts';
import { SITE } from '../src/lib/site-config.ts';
import { siteRoot as root } from '../src/lib/site-root.ts';

const render = path.join(os.tmpdir(), `og-default-${process.pid}.png`);
const browser = await launchBrowser();
try {
  await renderCard(browser, {
    width: 1200,
    height: 630,
    photoWidth: 462,
    eyebrow: SITE.focus.join(' • '),
    name: SITE.owner,
    tagline: 'Hands-on security & infrastructure projects',
    meta: 'Technical Solutions Engineer • CCNA • Security+',
    url: SITE.domain,
    photoPath: path.join(root, 'src/content/pages/home/images/portrait.jpg'),
    outPath: render,
    colors: brandCardColors(),
  });
} finally {
  await browser.close();
}

try {
  await sharp(render)
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .toFile(path.join(root, 'public/assets/og/og-default.jpg'));
} finally {
  fs.rmSync(render, { force: true });
}

console.log('Wrote public/assets/og/og-default.jpg (1200x630)');
