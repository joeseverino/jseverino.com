// Generated files are written by their sync/make script and verified by the
// same script with --check, which fails when a committed copy differs from
// what its canonical source would produce now.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';

export interface ProjectionTarget {
  file: string;
  content: string;
}

const display = (file: string): string => (file.startsWith(`${siteRoot}${path.sep}`) ? path.relative(siteRoot, file) : file);

// targets: [{ file, content }] with absolute paths. Writes the files whose
// content changed, or with check exits 1 naming them and the regenerate hint.
export function writeOrCheck(targets: readonly ProjectionTarget[], { check, hint }: { check: boolean; hint: string }): void {
  const stale = targets.filter(
    ({ file, content }) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content,
  );
  if (check) {
    if (stale.length === 0) return;
    console.error(`stale: ${stale.map(({ file }) => display(file)).join(', ')}\nrun: ${hint}`);
    process.exit(1);
  }
  for (const { file, content } of stale) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`wrote ${display(file)}`);
  }
}
