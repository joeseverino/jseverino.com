import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import mdx from '@astrojs/mdx';
import { satteri } from '@astrojs/markdown-satteri';
import sitemap from '@astrojs/sitemap';
import { SITE_ORIGIN as origin, writeupUrl } from './src/lib/site-config.ts';
import { snapshotWriteups } from './src/lib/snapshot.ts';
import { buildOutDir } from './src/lib/build-output.ts';
import { sitemapLastmods } from './src/lib/sitemap.ts';
import { contentOverlay } from './src/integrations/content-overlay.ts';
import { processorOptions } from './src/lib/markdown/index.ts';
import { IMAGE_WIDTHS } from './src/lib/images.ts';

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

// A page's sitemap lastmod is the date its own content carries (src/lib/sitemap.ts);
// pages with no date of their own get none rather than the build time.
const lastmods = sitemapLastmods(
  snapshotWriteups().map(({ slug, data }) => {
    const stamp = data.last_reviewed || data.published_at;
    return {
      url: writeupUrl(slug, origin),
      technologies: Array.isArray(data.technologies) ? data.technologies.map(String) : [],
      date: stamp instanceof Date || typeof stamp === 'string' ? stamp : undefined,
    };
  }),
  origin,
);

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
  // Content renders through Astro's Rust Markdown processor with the site's
  // plugins (src/lib/markdown/); MDX lets images render as <Picture>.
  markdown: {
    syntaxHighlight: false,
    processor: satteri(processorOptions),
  },
  // Content images: AVIF and WebP at the widths the layout serves. 768 is
  // there for the common 600-720px box (a split column, a project card at a
  // high device-pixel ratio): 512 undersizes it and 1024 ships about double
  // the bytes. Per-format quality keeps text in screenshots crisp.
  image: {
    breakpoints: IMAGE_WIDTHS,
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        avif: { quality: 60 },
        webp: { quality: 82 },
        jpeg: { quality: 82 },
        png: { compressionLevel: 9 },
      },
    },
  },
  integrations: [
    mdx(),
    contentOverlay(process.env.SITE_CONTENT_ROOT),
    sitemap({
      serialize(item) {
        const lastmod = lastmods.get(item.url);
        if (lastmod) item.lastmod = lastmod;
        else delete item.lastmod;
        return item;
      },
    }),
  ],
  // The whole stylesheet is ~8 KB compressed. Inlined, first paint does not
  // wait on a second round trip for it. It is the same text on every page, so
  // bin/build-csp.ts puts one hash in style-src and the CSP needs no
  // 'unsafe-inline'.
  build: {
    inlineStylesheets: 'always',
  },
  // Emit component <script> blocks as external /_astro/*.js files instead of
  // inlining them: script-src 'self' covers them without a hash, and the
  // browser caches bundled JS across pages.
  vite: {
    build: {
      assetsInlineLimit: 0,
      // Astro 7 / Vite 8 default the CSS minifier to lightningcss, which folds
      // `animation-timeline: scroll()` into the `animation` shorthand
      // (`animation: … name scroll()`), invalid syntax the browser drops, which
      // kills the scroll-driven header shadow. esbuild (Vite 7's default)
      // leaves it alone.
      cssMinify: 'esbuild',
      // Astro's MDX modules open with a "use astro:head-inject" directive the
      // bundler reports and then handles; only that report, and only for MDX.
      rolldownOptions: {
        onwarn(warning, warn) {
          if (warning.code === 'MODULE_LEVEL_DIRECTIVE' && warning.id?.includes('.mdx')) return;
          warn(warning);
        },
      },
    },
    server: {
      allowedHosts: devAllowedHosts,
    },
  },
});
