import fs from 'node:fs';
import path from 'node:path';

const IMPORT = /^@import\s+(?:url\()?['"](.+?)['"]\)?;\s*$/gm;

export function readCssEntry(entryPath) {
  const entry = fs.readFileSync(entryPath, 'utf8');
  const directory = path.dirname(entryPath);
  const modules = [...entry.matchAll(IMPORT)].map((match) =>
    fs.readFileSync(path.resolve(directory, match[1]), 'utf8'),
  );
  return `${entry.replace(IMPORT, '').trim()}\n\n${modules.join('\n')}`;
}
