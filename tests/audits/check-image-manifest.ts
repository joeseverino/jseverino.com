#!/usr/bin/env node
// The synced images and src/lib/image-manifest.json agree: every png/jpg under
// public/assets/{writeups,pages} has a manifest entry (images.ts fails a build
// without one), and every variant and fallback the manifest names exists.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';
import { walkFiles } from '../../src/lib/walk.ts';
import type { Manifest } from '../../src/lib/images.ts';
import { readJson } from '../../src/lib/json.ts';
import { finish } from './lib.ts';

const manifest: Manifest = readJson(path.join(siteRoot, 'src/lib/image-manifest.json'));
const publicDir = path.join(siteRoot, 'public');
const toUrl = (file: string): string => `/${path.relative(publicDir, file).split(path.sep).join('/')}`;
const failures: string[] = [];

const rasters = ['writeups', 'pages'].flatMap((collection) =>
  walkFiles(path.join(publicDir, 'assets', collection), { filter: (file) => /\.(?:png|jpe?g)$/i.test(file) }));
for (const file of rasters) {
  if (!manifest[toUrl(file)]) failures.push(`no manifest entry: ${toUrl(file)}`);
}

let variants = 0;
for (const [url, entry] of Object.entries(manifest)) {
  for (const named of [entry.fallback, ...entry.avif.map(([, u]) => u), ...entry.webp.map(([, u]) => u)]) {
    variants += 1;
    if (!fs.existsSync(path.join(publicDir, named))) failures.push(`${url}: missing ${named}`);
  }
}

finish(failures, `${rasters.length} synced images have manifest entries; all ${variants} named files exist`, {
  bullet: '- ',
  fix: 'run: npm run sync:content, then commit src/lib/image-manifest.json with public/assets',
});
