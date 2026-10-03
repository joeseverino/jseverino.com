#!/usr/bin/env node
// Regenerates the fixture images and their manifest (the same AVIF/WebP
// variant shape bin/sync-content.ts writes). Shapes only, no text, so the
// output does not depend on the fonts of the machine that runs it.
//
//   node tests/fixtures/make-images.ts
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { Manifest, Variant } from '../../src/lib/images.ts';

const root = path.join(import.meta.dirname, 'content');
const urlDir = '/assets/fixtures';
const outDir = path.join(root, 'public', urlDir);
const WIDTHS = [512, 768, 1024, 1600];

type Point = [x: number, y: number];

const node = (x: number, y: number, r: number, fill: string): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const link = (x1: number, y1: number, x2: number, y2: number): string =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#93a4c8" stroke-width="6"/>`;

function diagram(width: number, height: number, background: string, [hub, ...spokes]: [Point, ...Point[]]): string {
  const [hx, hy] = hub;
  const points = [hub, ...spokes];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="${background}"/>
    ${spokes.map(([x, y]) => link(hx, hy, x, y)).join('')}
    ${points.map(([x, y], index) => node(x, y, index === 0 ? 70 : 44, index === 0 ? '#1e3a8a' : '#3b5bdb')).join('')}
  </svg>`;
}

const images = {
  'network-lab-cover.png': diagram(1200, 675, '#eef2fb', [[600, 338], [260, 150], [940, 150], [260, 526], [940, 526]]),
  'network-lab-topology.png': diagram(1200, 750, '#f6f8fc', [[600, 375], [180, 375], [1020, 375], [600, 110], [600, 640]]),
  'detection-pipeline-cover.png': diagram(1200, 675, '#edf6f1', [[200, 338], [500, 338], [800, 338], [1000, 338]]),
  'hardening-checklist-cover.png': diagram(1200, 675, '#fbf3ea', [[600, 338], [380, 200], [820, 200], [600, 560]]),
  'archive-entry-cover.png': diagram(1200, 675, '#f3eefb', [[300, 338], [900, 338]]),
  'portrait.png': diagram(680, 680, '#e7ecf7', [[340, 300], [340, 560]]),
};

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const manifest: Manifest = {};

for (const [name, svg] of Object.entries(images)) {
  const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(path.join(outDir, name), png);
  // sharp always reports dimensions for a PNG it just encoded.
  const { width = 0, height = 0 } = await sharp(png).metadata();
  const base = path.basename(name, '.png');
  const widths = [...new Set([...WIDTHS.filter((w) => w < width), Math.min(width, Math.max(...WIDTHS))])];
  const avif: Variant[] = [];
  const webp: Variant[] = [];
  for (const w of widths) {
    fs.writeFileSync(path.join(outDir, `${base}-${w}.avif`), await sharp(png).resize({ width: w }).avif({ quality: 60 }).toBuffer());
    fs.writeFileSync(path.join(outDir, `${base}-${w}.webp`), await sharp(png).resize({ width: w }).webp({ quality: 82 }).toBuffer());
    avif.push([w, `${urlDir}/${base}-${w}.avif`]);
    webp.push([w, `${urlDir}/${base}-${w}.webp`]);
  }
  manifest[`${urlDir}/${name}`] = { w: width, h: height, avif, webp, fallback: `${urlDir}/${name}` };
}

fs.writeFileSync(path.join(root, 'image-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${Object.keys(manifest).length} fixture images to ${path.relative(process.cwd(), outDir)}`);
