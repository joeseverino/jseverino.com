#!/usr/bin/env node
// Every image the build ships, with count and weight. STRICT_ASSET_AUDIT=1 fails images at or over the limit.
import fs from 'node:fs';
import path from 'node:path';
import { builtPages } from './lib.ts';

const { distDir } = builtPages('audit-assets');
const warnBytes = Number(process.env.ASSET_WARN_MB ?? 1.5) * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const images = fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' })
  .filter((relative) => /\.(?:png|jpe?g|webp|avif|gif|svg)$/i.test(relative))
  .map((relative) => ({ relative, bytes: fs.statSync(path.join(distDir, relative)).size }))
  .sort((a, b) => b.bytes - a.bytes);

const total = images.reduce((sum, image) => sum + image.bytes, 0);
const large = images.filter((image) => image.bytes >= warnBytes);

console.log(`Images: ${images.length}`);
console.log(`Total image weight: ${formatBytes(total)}`);

if (large.length === 0) {
  console.log(`No images over ${formatBytes(warnBytes)}.`);
  process.exit(0);
}

console.log(`Images over ${formatBytes(warnBytes)}:`);
for (const image of large.slice(0, 25)) {
  console.log(`- ${formatBytes(image.bytes)}  ${image.relative}`);
}

if (process.env.STRICT_ASSET_AUDIT === '1') {
  console.error(`fix: shrink each image above below ${formatBytes(warnBytes)}: the committed file under public/assets/, or the content original it was encoded from`);
  process.exitCode = 1;
}
