#!/usr/bin/env node
// Remove build output and build caches. Synced content is never touched here:
// sync-content owns src/content and public/assets.
import fs from 'node:fs';
import { cli } from './lib/args.ts';
import { buildOutDir } from '../src/lib/build-output.ts';
import { fromRoot } from '../src/lib/site-root.ts';

cli({ usage: 'usage: node bin/clean-generated.ts' });

for (const target of ['.astro', buildOutDir, 'node_modules/.vite']) {
  fs.rmSync(fromRoot(target), { recursive: true, force: true });
}
