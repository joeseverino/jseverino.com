import cloudflare from '@astrojs/cloudflare';
import { satteri } from '@astrojs/markdown-satteri';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import { contentOverlay } from './src/integrations/content-overlay.ts';
import { sitedriftPreview } from './src/integrations/sitedrift-preview.ts';
import { astroOutDir } from './src/lib/build-output.ts';
import { IMAGE_WIDTHS } from './src/lib/images.ts';
import { processorOptions } from './src/lib/markdown/index.ts';
import { SITE_ORIGIN as origin, writeupUrl } from './src/lib/site-config.ts';
import { sitemapLastmods } from './src/lib/sitemap.ts';
import { snapshotWriteups } from './src/lib/snapshot.ts';

// Dev server settings from the [env] of the gitignored mise.local.toml, which mise exports to every task.
const { DEV_ALLOWED_HOSTS, DEV_HOST, DEV_PORT } = process.env;
const devAllowedHosts = DEV_ALLOWED_HOSTS ? DEV_ALLOWED_HOSTS.split(',').map((h) => h.trim()) : [];
const devHost = DEV_HOST === 'true' || DEV_HOST === '1';
const devPort = DEV_PORT ? Number(DEV_PORT) : undefined;

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
  // Every page is prerendered; the routes that set `prerender = false` run in the Worker.
  output: 'static',
  adapter: cloudflare({
    // Every image is encoded at build time by `image.service` below (sharp and its settings), and
    // the Worker serves the files. `astro dev` transforms through the local Images binding.
    imageService: 'compile',
    // Pages render in Node: the content code reads the filesystem and satteri loads a native binding, neither of which workerd has.
    prerenderEnvironment: 'node',
  }),
  // Nothing uses sessions, so the adapter provisions no KV namespace for them.
  session: false,
  // Pages keep their slash through `html_handling` in wrangler.jsonc, which redirects /about to
  // /about/. Here 'always' would also redirect the API's /api/contact to /api/contact/.
  trailingSlash: 'ignore',
  outDir: `./${astroOutDir}`,
  // Encoded images are cached by source and options, so one cache serves every
  // checkout and worktree; mise's [env] sets it under the repository's cache root.
  ...(process.env.ASTRO_CACHE_DIR && { cacheDir: process.env.ASTRO_CACHE_DIR }),
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
    sitedriftPreview(),
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
      // lightningcss, Vite's default, folds `animation-timeline: scroll()` into the `animation`
      // shorthand, which no browser parses, so the scroll-driven header shadow never runs.
      // esbuild keeps the longhand; it is a devDependency because Vite only lists it as an optional peer.
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
