// One directory walker for every audit and script that lists files. Returns
// absolute paths; callers map to relative paths where they need them.
import fs from 'node:fs';
import path from 'node:path';

// `filter(absolutePath, dirent)` decides which files are returned.
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
