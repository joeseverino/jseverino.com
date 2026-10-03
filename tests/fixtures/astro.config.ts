// The visual suite's build: the site's own config, rendered from the fixture
// content tree into its own output and cache dirs so it never collides with
// the real build. SITE_CONTENT_ROOT must be set in the environment (the
// visual Playwright config does it) because content.config.ts reads it.
import path from 'node:path';
import type { AstroUserConfig } from 'astro';
import base from '../../astro.config.ts';

const fixtureRoot = path.resolve(import.meta.dirname, 'content');
if (path.resolve(process.env.SITE_CONTENT_ROOT ?? '') !== fixtureRoot) {
  throw new Error(`SITE_CONTENT_ROOT must be ${path.relative(process.cwd(), fixtureRoot)}`);
}

export default {
  ...base,
  outDir: './dist-visual',
  cacheDir: './node_modules/.astro-visual',
} satisfies AstroUserConfig;
