// Generates the 1280x640 GitHub repo social preview at .github/social-preview.png.
// Upload via the repo's Settings -> Social preview. Not served from the site.
// Run with: node bin/make-github-social.mjs
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
    width: 1280,
    height: 640,
    photoWidth: 480,
    eyebrow: 'GitHub • Open Source',
    name: SITE.domain,
    tagline: 'Source for my personal site',
    meta: 'Astro • TypeScript • Cloudflare Pages',
    url: `github.com/${SITE.github}/${SITE.domain}`,
    photoPath: path.join(root, 'public/assets/pages/home/images/portrait.jpg'),
    outPath: path.join(root, '.github/social-preview.png'),
    colors,
  });
} finally {
  await browser.close();
}

console.log('Wrote .github/social-preview.png (1280x640)');
