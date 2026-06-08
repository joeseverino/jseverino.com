#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const removeBuildOutput = process.argv.includes('--all');

// Directories that sync-content fully regenerates and that ship in the build.
// The repo lives in an iCloud-synced folder, so iCloud spawns numbered conflict
// copies whenever these get rewritten — they must be resolved before a publish.
const generatedRoots = [
  'src/content',
  'public/assets',
];

// Pure build caches — safe to delete wholesale, never conflict-resolved.
// `dist.nosync` is the local Astro outDir (see astro.config.mjs); the
// `.nosync` suffix keeps it outside iCloud so this delete stays a fast,
// local operation instead of crawling through the iCloud FileProvider.
const buildOutput = ['.astro', 'dist.nosync', 'node_modules/.vite'];

function remove(target) {
  try {
    fs.rmSync(path.join(siteRoot, target), { recursive: true, force: true });
  } catch (err) {
    if (err.code === 'ENOTEMPTY' || err.code === 'EBUSY') {
      console.warn(`Warning: Could not fully remove ${target} (it may be in use).`);
    } else {
      throw err;
    }
  }
}

function removeRootConflicts() {
  let removed = 0;

  for (const entry of fs.readdirSync(siteRoot, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    if (isNumberedConflict(entry.name)) {
      fs.rmSync(path.join(siteRoot, entry.name), { recursive: true, force: true });
      console.log(`Removed root conflict copy: ${entry.name}`);
      removed += 1;
    }
  }

  return removed;
}

// A trailing " <number>" before the extension (or end of a directory name) is
// iCloud's conflict-copy naming, e.g. "home 4.md", "building-a-homelab 2".
// The leading space is required, so kebab-case slugs like "vsftpd-2-3-4" are safe.
function isNumberedConflict(name) {
  return / \d+(?:\.[^.]+)?$/.test(name);
}

function canonicalName(name) {
  return name.replace(/ \d+(?=\.[^.]+$|$)/, '');
}

// Compare conflict copies by content freshness. A synced writeup is a
// <slug>/index.md directory, so use the index.md mtime for directories.
function freshness(entryPath) {
  const stat = fs.statSync(entryPath);
  if (stat.isDirectory()) {
    const index = path.join(entryPath, 'index.md');
    if (fs.existsSync(index)) return fs.statSync(index).mtimeMs;
  }
  return stat.mtimeMs;
}

// Resolve iCloud conflict copies: among "name.ext" + "name N.ext", keep the
// canonical tracked path whenever it exists and drop the numbered copies. If
// iCloud renamed the canonical path away entirely, restore the newest numbered
// copy back to the canonical name.
function resolveNumberedCopies(root) {
  const fullRoot = path.join(siteRoot, root);
  if (!fs.existsSync(fullRoot)) return 0;

  let removed = 0;
  const groups = new Map();

  for (const entry of fs.readdirSync(fullRoot, { withFileTypes: true })) {
    const canonical = canonicalName(entry.name);
    if (!groups.has(canonical)) groups.set(canonical, []);
    groups.get(canonical).push(entry.name);
  }

  for (const [canonical, names] of groups) {
    if (names.length > 1 || names.some(isNumberedConflict)) {
      const canonicalPath = path.join(fullRoot, canonical);
      const canonicalExists = fs.existsSync(canonicalPath);
      const winner = canonicalExists
        ? canonical
        : names
            .map((name) => ({ name, mtime: freshness(path.join(fullRoot, name)) }))
            .sort((a, b) => b.mtime - a.mtime)[0].name;

      for (const name of names) {
        if (name === winner) continue;
        fs.rmSync(path.join(fullRoot, name), { recursive: true, force: true });
        console.log(`Removed conflict copy: ${path.join(root, name)}`);
        removed += 1;
      }

      if (winner !== canonical) {
        fs.renameSync(
          path.join(fullRoot, winner),
          path.join(fullRoot, canonical),
        );
        console.log(`Restored newest copy to canonical name: ${path.join(root, canonical)}`);
      }
    }

    const canonicalPath = path.join(fullRoot, canonical);
    if (fs.existsSync(canonicalPath) && fs.statSync(canonicalPath).isDirectory()) {
      removed += resolveNumberedCopies(path.join(root, canonical));
    }
  }

  return removed;
}

if (removeBuildOutput) {
  for (const target of buildOutput) remove(target);
}

const removed = removeRootConflicts() + generatedRoots.reduce(
  (count, root) => count + resolveNumberedCopies(root),
  0,
);

if (removed > 0) {
  console.log(`Resolved ${removed} iCloud conflict copy/copies.`);
}
