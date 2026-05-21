import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// Build output goes to `dist/` on Cloudflare Pages (it sets CF_PAGES=1) and to
// `dist.nosync/` locally. The `.nosync` suffix keeps iCloud Drive from syncing
// and evicting build output — without it, every local build and clean crawls.
const outDir = process.env.CF_PAGES ? './dist' : './dist.nosync';

export default defineConfig({
  site: 'https://jseverino.com',
  trailingSlash: 'always',
  outDir,
  integrations: [sitemap()],
});
