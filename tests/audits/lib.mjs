// Shared plumbing for the post-build audits: resolve the built output via the
// single-source decision in src/lib/build-output.mjs, walk its files, and
// enforce the zero-pages floor — an empty or stale outDir is a broken build,
// not a pass, so it exits non-zero instead of green-lighting "ok 0 pages".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveBuiltDir } from '../../src/lib/build-output.mjs';

export const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function walkFiles(dir, predicate = () => true, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, predicate, files);
    else if (predicate(entry.name)) files.push(full);
  }
  return files;
}

export function builtHtmlPages(auditName) {
  const distDir = resolveBuiltDir(siteRoot);
  if (!distDir) {
    console.error(`${auditName}: no build output found. Run \`astro build\` first.`);
    process.exit(1);
  }
  const pages = walkFiles(distDir, (name) => name.endsWith('.html'));
  if (pages.length === 0) {
    console.error(`${auditName}: no HTML pages found in ${path.relative(siteRoot, distDir)}. Run the build first.`);
    process.exit(1);
  }
  return { distDir, pages };
}
