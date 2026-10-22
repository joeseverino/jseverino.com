#!/usr/bin/env node
// Generates the 1280x640 GitHub social preview at .github/social-preview.png
// (uploaded manually in repo settings).
import { SITE, SITE_REPOSITORY } from '../src/lib/site-config.ts';
import { fromRoot } from '../src/lib/site-root.ts';
import { cli } from './lib/args.ts';
import { renderBrandCard } from './lib/brand-card.ts';

cli({ usage: 'usage: node bin/make-github-social.ts' });

await renderBrandCard({
  width: 1280,
  height: 640,
  photoWidth: 480,
  eyebrow: 'GitHub • Open Source',
  name: SITE.domain,
  tagline: 'Source for my personal site',
  meta: 'Astro • TypeScript • Cloudflare Workers',
  url: `github.com/${SITE_REPOSITORY}`,
  outPath: fromRoot('.github/social-preview.png'),
});

console.log('Wrote .github/social-preview.png (1280x640)');
