// Remove files under the managed roots that the run did not write (unpublished
// documents, unreferenced assets, variants of a changed source), then the
// directories that leaves empty. Returns the removed files.
import fs from 'node:fs';
import path from 'node:path';
import { walkFiles } from '../../src/lib/walk.ts';

function removeEmptyDirs(dir: string, root: string): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name), root);
  }
  if (dir !== root && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

export async function pruneOrphans(roots: readonly string[], keep: ReadonlySet<string>): Promise<string[]> {
  const removed: string[] = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const file of walkFiles(root)) {
      if (keep.has(file)) continue;
      fs.rmSync(file, { force: true });
      removed.push(file);
    }
    removeEmptyDirs(root, root);
  }
  return removed;
}
