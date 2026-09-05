// Generates the 1200x630 Open Graph social card at public/assets/og/og-default.png.
// Run with: node bin/make-og-image.mjs
import path from 'node:path';
import { renderCard, launchBrowser } from 'branding-engine';
import { brandCardColors } from '../src/lib/brand.mjs';
import { SITE } from '../src/lib/site-config.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const root = siteRoot;
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
    photoPath: path.join(root, 'public/assets/pages/home/images/portrait.jpg'),
    outPath: path.join(root, 'public/assets/og/og-default.png'),
    colors: brandCardColors(),
  });
} finally {
  await browser.close();
}

console.log('Wrote public/assets/og/og-default.png (1200x630)');
