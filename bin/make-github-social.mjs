// Generates the 1280x640 GitHub repo social preview at .github/social-preview.png.
// Upload via the repo's Settings -> Social preview. Not served from the site.
// Run with: node bin/make-github-social.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from './lib/card.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await renderCard({
  width: 1280,
  height: 640,
  photoWidth: 480,
  eyebrow: 'GitHub • Open Source',
  name: 'jseverino.com',
  tagline: 'Source for my personal site',
  meta: 'Astro • TypeScript • Cloudflare Pages',
  url: 'github.com/joeseverino/jseverino.com',
  photoPath: path.join(root, 'public/assets/pages/home/images/portrait.jpg'),
  outPath: path.join(root, '.github/social-preview.png'),
});

console.log('Wrote .github/social-preview.png (1280x640)');
