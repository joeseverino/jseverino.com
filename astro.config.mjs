import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import sitemap from '@astrojs/sitemap';
import matter from 'gray-matter';

// Local-only dev server settings, sourced from the gitignored .env so no
// machine-specific values land in the repo. All unset in prod/CI, so the build
// is unaffected and a fresh clone behaves like vanilla Astro.
//   DEV_ALLOWED_HOSTS  comma-separated hostnames the dev server answers to (NPM reverse proxy)
//   DEV_HOST           "true" to bind all interfaces so the tailnet/LAN can reach it
//   DEV_PORT           pin a deterministic port; if it's busy Astro just picks the next one
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
const devAllowedHosts = env.DEV_ALLOWED_HOSTS ? env.DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()) : [];
const devHost = env.DEV_HOST === 'true' || env.DEV_HOST === '1';
const devPort = env.DEV_PORT ? Number(env.DEV_PORT) : undefined;

// Build output goes to `dist/` on Cloudflare Pages (it sets CF_PAGES=1) and to
// `dist.nosync/` locally. The `.nosync` suffix keeps iCloud Drive from syncing
// and evicting build output — without it, every local build and clean crawls.
const outDir = process.env.CF_PAGES ? './dist' : './dist.nosync';

// Per-writeup last_reviewed from synced frontmatter so Google has a recrawl
// hint for individual portfolio pages. All other URLs fall back to the build
// timestamp, which still nudges Google to recheck the rest of the site.
function buildLastmodMap() {
  const dir = path.resolve('src/content/writeups');
  const map = new Map();
  if (!fs.existsSync(dir)) return map;
  for (const slug of fs.readdirSync(dir)) {
    const file = path.join(dir, slug, 'index.md');
    if (!fs.existsSync(file)) continue;
    try {
      const { data } = matter(fs.readFileSync(file, 'utf8'));
      const stamp = data.last_reviewed || data.published_at;
      if (stamp) map.set(`https://jseverino.com/portfolio/${slug}/`, new Date(stamp).toISOString());
    } catch {
      // Ignore unparseable frontmatter — the URL just falls back to build time.
    }
  }
  return map;
}

const writeupLastmod = buildLastmodMap();
const buildLastmod = new Date().toISOString();

export default defineConfig({
  site: 'https://jseverino.com',
  trailingSlash: 'always',
  outDir,
  devToolbar: {
    enabled: false,
  },
  server: {
    ...(devHost && { host: true }),
    ...(devPort && { port: devPort }),
  },
  integrations: [
    sitemap({
      serialize(item) {
        item.lastmod = writeupLastmod.get(item.url) || buildLastmod;
        return item;
      },
    }),
  ],
  // Emit component <script> blocks as external /_astro/*.js files instead of
  // inlining them. The middleware still nonces every <script> tag, so CSP is
  // unaffected; this keeps the rendered HTML clean and lets the browser cache
  // bundled JS across pages.
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
    server: {
      allowedHosts: devAllowedHosts,
    },
  },
});
