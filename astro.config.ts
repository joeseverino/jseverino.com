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

// Local-only dev server settings from the gitignored .env; unset in prod/CI.
//   DEV_ALLOWED_HOSTS  comma-separated hostnames the dev server answers to
//   DEV_HOST           "true" binds all interfaces
//   DEV_PORT           pin the port
const env = loadEnv(process.env.NODE_ENV ?? 'development', process.cwd(), '');
const devAllowedHosts = env.DEV_ALLOWED_HOSTS ? env.DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()) : [];
const devHost = env.DEV_HOST === 'true' || env.DEV_HOST === '1';
const devPort = env.DEV_PORT ? Number(env.DEV_PORT) : undefined;

const outDir = `./${buildOutDir}`;

// Sitemap lastmod comes from the page's own content date (src/lib/sitemap.ts).
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
  // Site plugins in src/lib/markdown/; MDX lets images render as <Picture>.
  markdown: {
    syntaxHighlight: false,
    processor: satteri(processorOptions),
  },
  // 768 covers the common 600-720px box: 512 undersizes it and 1024 ships about double the bytes.
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
  // Inlined: same text on every page, so bin/build-csp.ts puts one hash in style-src and the CSP needs no 'unsafe-inline'.
  build: {
    inlineStylesheets: 'always',
  },
  // External scripts: script-src 'self' covers them without a hash.
  vite: {
    build: {
      assetsInlineLimit: 0,
      // lightningcss folds `animation-timeline: scroll()` into the `animation` shorthand,
      // invalid syntax that kills the scroll-driven header shadow. esbuild leaves it alone.
      cssMinify: 'esbuild',
      // Silences the bundler's report of Astro's "use astro:head-inject" directive in MDX modules.
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
