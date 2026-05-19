#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const removeBuildOutput = process.argv.includes('--all');

const generatedRoots = [
  'src/content/pages',
  'src/content/writeups',
  'public/assets/pages',
  'public/assets/writeups',
  '.astro',
  'node_modules/.vite',
];

const buildOutput = ['.astro', 'dist', 'node_modules/.vite'];

function remove(target) {
  fs.rmSync(path.join(siteRoot, target), { recursive: true, force: true });
}

function isNumberedConflict(name) {
  return / \d+(?:\.[^.]+)?$/.test(name);
}

function removeNumberedCopies(root) {
  const fullRoot = path.join(siteRoot, root);
  if (!fs.existsSync(fullRoot)) return 0;

  let removed = 0;
  for (const entry of fs.readdirSync(fullRoot, { withFileTypes: true })) {
    const fullPath = path.join(fullRoot, entry.name);
    const relative = path.relative(siteRoot, fullPath);

    if (isNumberedConflict(entry.name)) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      console.log(`Removed numbered generated copy: ${relative}`);
      removed += 1;
      continue;
    }

    if (entry.isDirectory()) {
      removed += removeNumberedCopies(relative);
    }
  }

  return removed;
}

if (removeBuildOutput) {
  for (const target of buildOutput) remove(target);
}

const removed = generatedRoots.reduce(
  (count, root) => count + removeNumberedCopies(root),
  0,
);

if (removed > 0) {
  console.log(`Cleaned ${removed} numbered generated copy/copies.`);
}
