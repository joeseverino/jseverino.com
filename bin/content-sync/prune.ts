// Remove files under the managed roots that the run did not write, then the directories left empty. Returns the removed files.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../../src/lib/walk.ts';

// Deepest first, so a directory holding only empty directories empties too.
function removeEmptyDirs(root: string): void {
  const dirs = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted((a, b) => b.length - a.length);
  for (const dir of dirs) if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

export function pruneOrphans(roots: readonly string[], keep: ReadonlySet<string>): string[] {
  const removed: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkFiles(root)) {
      if (keep.has(file)) continue;
      fs.rmSync(file, { force: true });
      removed.push(file);
    }
    removeEmptyDirs(root);
  }
  return removed;
}
