// Generates the 1280x640 GitHub repo social preview at .github/social-preview.png.
// Upload via the repo's Settings -> Social preview. Not served from the site.
// Run with: node bin/make-github-social.mjs
import path from 'node:path';
import { renderCard, launchBrowser } from 'branding-engine';
import { brandCardColors } from '../src/lib/brand.mjs';
import { SITE } from '../src/lib/site-config.mjs';
import { siteRoot } from '../src/lib/site-root.mjs';

const root = siteRoot;
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
    colors: brandCardColors(),
  });
} finally {
  await browser.close();
}

console.log('Wrote .github/social-preview.png (1280x640)');
