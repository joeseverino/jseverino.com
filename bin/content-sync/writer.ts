// The one place the sync touches disk. Every written file is recorded, so prune removes only files this run
// did not produce and the report names exactly what the sync owns.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pruneOrphans } from './prune.ts';

// What a sync owns, relative to the layout root: `--report` writes this JSON.
export interface SyncReport {
  written: string[];
  removed: string[];
}

export function createWriter({ root }: { root: string }) {
  const written = new Set<string>();
  const removed: string[] = [];
  const relative = (file: string): string => path.relative(root, file).split(path.sep).join('/');

  return {
    root,
    written,
    async write(file: string, content: string | Uint8Array): Promise<void> {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, content);
      written.add(file);
    },
    async copy(source: string, target: string): Promise<void> {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
      written.add(target);
    },
    // Runs once, after a complete pass: an aborted run deletes nothing.
    async prune(roots: readonly string[]): Promise<void> {
      removed.push(...(await pruneOrphans(roots, written)));
    },
    report(): SyncReport {
      return {
        written: [...written].map(relative).sort(),
        removed: removed.map(relative).sort(),
      };
    },
  };
}
