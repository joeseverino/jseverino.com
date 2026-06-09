// Generates the 1200x630 Open Graph social card at public/assets/og/og-default.png.
// Run with: node bin/make-og-image.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard, launchBrowser } from 'branding-engine';
import { BRAND } from '../src/lib/brand.mjs';
import { SITE } from '../src/lib/site-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const colors = {
  panel: BRAND.navy, panelDeep: BRAND.navyDeep, onPanel: BRAND.onNavy,
  accent: BRAND.card.accent, textSoft: BRAND.card.textSoft, textMuted: BRAND.card.textMuted,
};

const browser = await launchBrowser();
try {
  await renderCard(browser, {
    width: 1200,
    height: 630,
    photoWidth: 462,
    eyebrow: 'Cybersecurity • Networking',
    name: SITE.owner,
    tagline: 'Hands-on security & infrastructure projects',
    meta: 'CCNA • Security+ • ISC2 CC',
    url: SITE.domain,
    photoPath: path.join(root, 'public/assets/pages/home/images/portrait.jpg'),
    outPath: path.join(root, 'public/assets/og/og-default.png'),
    colors,
  });
} finally {
  await browser.close();
}

console.log('Wrote public/assets/og/og-default.png (1200x630)');
