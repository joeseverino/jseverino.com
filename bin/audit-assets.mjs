#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsRoot = path.join(siteRoot, 'public/assets');
const warnBytes = Number(process.env.ASSET_WARN_MB ?? 1.5) * 1024 * 1024;

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath, files);
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

const images = walk(assetsRoot)
  .filter((file) => /\.(?:png|jpe?g|webp|gif|svg)$/i.test(file))
  .map((file) => ({
    file,
    relative: path.relative(siteRoot, file),
    bytes: fs.statSync(file).size,
  }))
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
  process.exitCode = 1;
}
