// Shared plumbing for the post-build audits: resolve the built output via the
// single-source decision in src/lib/build-output.mjs, walk its files, and
// enforce the zero-pages floor — an empty or stale outDir is a broken build,
// not a pass, so it exits non-zero instead of green-lighting "ok 0 pages".
import path from 'node:path';
import { resolveBuiltDir } from '../../src/lib/build-output.mjs';
import { siteRoot } from '../../src/lib/site-root.mjs';
import { walkFiles as walkTree } from '../../src/lib/walk.mjs';

export { siteRoot };

// The audits select built files by basename.
export const walkFiles = (dir, predicate = () => true) =>
  walkTree(dir, { filter: (_file, entry) => predicate(entry.name) });

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
