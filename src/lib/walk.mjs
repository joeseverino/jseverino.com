// One directory walker for every audit and script that lists files. Returns
// absolute paths; callers map to relative paths where they need them.
import fs from 'node:fs';
import path from 'node:path';

// iCloud Drive leaves numbered conflict copies ("README 2.md") beside the real
// file. They are never real sources, and the gates refuse to track them.
export const conflictCopyRe = / \d+(?:\.[^/]*)?$/;

export const isConflictCopy = (name) => conflictCopyRe.test(name);

// `filter(absolutePath, dirent)` decides which files are returned; `skip(dirent,
// parentDir)` prunes an entry before descent, so a whole directory can be excluded.
export function walkFiles(dir, { filter = () => true, skip = () => false } = {}, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip(entry, dir)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, { filter, skip }, files);
    else if (entry.isFile() && filter(full, entry)) files.push(full);
  }
  return files;
}
