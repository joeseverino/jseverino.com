// Returns absolute paths.
import fs from 'node:fs';
import path from 'node:path';

export type WalkFilter = (file: string, entry: fs.Dirent) => boolean;

export function walkFiles(dir: string, { filter = () => true }: { filter?: WalkFilter } = {}, files: string[] = []): string[] {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, { filter }, files);
    else if (entry.isFile() && filter(full, entry)) files.push(full);
  }
  return files;
}
