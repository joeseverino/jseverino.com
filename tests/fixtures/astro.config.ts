// The visual suite's build: the site's own config, rendered from the fixture
// content tree into its own output and cache dirs so it never collides with
// the real build. SITE_CONTENT_ROOT must be set in the environment (the
// visual Playwright config does it) because content.config.ts reads it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AstroIntegration, AstroUserConfig } from 'astro';
import base from '../../astro.config.ts';

const fixtureRoot = path.resolve(import.meta.dirname, 'content');
if (path.resolve(process.env.SITE_CONTENT_ROOT ?? '') !== fixtureRoot) {
  throw new Error(`SITE_CONTENT_ROOT must be ${path.relative(process.cwd(), fixtureRoot)}`);
}

// Fixture images live beside the fixture content, outside public/.
const fixtureAssets: AstroIntegration = {
  name: 'fixture-assets',
  hooks: {
    'astro:build:done': ({ dir }) => {
      fs.cpSync(path.join(fixtureRoot, 'public'), fileURLToPath(dir), { recursive: true });
    },
  },
};

export default {
  ...base,
  outDir: './dist-visual',
  cacheDir: './node_modules/.astro-visual',
  integrations: [...(base.integrations ?? []), fixtureAssets],
} satisfies AstroUserConfig;
