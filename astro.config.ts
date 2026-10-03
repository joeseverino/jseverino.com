import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import sitemap from '@astrojs/sitemap';
import { SITE_ORIGIN as origin, writeupUrl } from './src/lib/site-config.ts';
import { snapshotWriteups } from './src/lib/snapshot.ts';
import { buildOutDir } from './src/lib/build-output.ts';
import { cspNonce } from './src/integrations/csp-nonce.ts';
import { contentOverlay } from './src/integrations/content-overlay.ts';

// Local-only dev server settings, sourced from the gitignored .env so no
// machine-specific values land in the repo. All unset in prod/CI, so the build
// is unaffected.
//   DEV_ALLOWED_HOSTS  comma-separated hostnames the dev server answers to (NPM reverse proxy)
//   DEV_HOST           "true" to bind all interfaces so the tailnet/LAN can reach it
//   DEV_PORT           pin a deterministic port; if it's busy Astro just picks the next one
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
const devAllowedHosts = env.DEV_ALLOWED_HOSTS ? env.DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()) : [];
const devHost = env.DEV_HOST === 'true' || env.DEV_HOST === '1';
const devPort = env.DEV_PORT ? Number(env.DEV_PORT) : undefined;

const outDir = `./${buildOutDir}`;

// Per-writeup last_reviewed from synced frontmatter so Google has a recrawl
// hint for individual portfolio pages. All other URLs fall back to the build
// timestamp, which still nudges Google to recheck the rest of the site.
function buildLastmodMap(): Map<string, string> {
  const map = new Map<string, string>();
  for (const { slug, data } of snapshotWriteups()) {
    const stamp = data.last_reviewed || data.published_at;
    if (!(stamp instanceof Date || typeof stamp === 'string')) continue;
    const time = new Date(stamp);
    // An unparseable date falls back to the build time.
    if (!Number.isNaN(time.getTime())) map.set(writeupUrl(slug, origin), time.toISOString());
  }
  return map;
}

const writeupLastmod = buildLastmodMap();
// Honor SOURCE_DATE_EPOCH (Unix seconds) for reproducible builds: with it set, a
// no-op change yields byte-identical output, which bin/diff-build.ts relies on
// to surface only real differences. Normal builds fall back to the wall clock.
const buildLastmod = process.env.SOURCE_DATE_EPOCH
  ? new Date(Number(process.env.SOURCE_DATE_EPOCH) * 1000).toISOString()
  : new Date().toISOString();

export default defineConfig({
  site: origin,
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
    cspNonce(),
    contentOverlay(process.env.SITE_CONTENT_ROOT),
    sitemap({
      serialize(item) {
        item.lastmod = writeupLastmod.get(item.url) || buildLastmod;
        return item;
      },
    }),
  ],
  // The whole stylesheet is ~8 KB compressed. Inlined, first paint does not
  // wait on a second round trip for it; the csp-nonce integration stamps the
  // <style> tag in <head> for the middleware to nonce, so the CSP stays nonce-only.
  build: {
    inlineStylesheets: 'always',
  },
  // Emit component <script> blocks as external /_astro/*.js files instead of
  // inlining them. The csp-nonce integration stamps exactly that external
  // module-script shape for the middleware to nonce, and the browser caches
  // bundled JS across pages.
  vite: {
    build: {
      assetsInlineLimit: 0,
      // Astro 7 / Vite 8 default the CSS minifier to lightningcss, which folds
      // `animation-timeline: scroll()` into the `animation` shorthand
      // (`animation: … name scroll()`), invalid syntax the browser drops, which
      // kills the scroll-driven header shadow. esbuild (Vite 7's default)
      // leaves it alone.
      cssMinify: 'esbuild',
    },
    server: {
      allowedHosts: devAllowedHosts,
    },
  },
});
