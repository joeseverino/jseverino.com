// Generated files are written by their script and verified by it with --check, which fails when a committed copy differs.
import fs from 'node:fs';
import path from 'node:path';
import { siteRoot } from '../../src/lib/site-root.ts';

export interface ProjectionTarget {
  file: string;
  content: string;
}

const display = (file: string): string => (file.startsWith(`${siteRoot}${path.sep}`) ? path.relative(siteRoot, file) : file);

// The command that regenerates: the mise task this script runs as, or the script itself outside mise.
export const regenerateCommand = (): string => {
  const task = process.env.MISE_TASK_NAME;
  return task ? `mise run ${task}` : `node ${display(process.argv[1] ?? '')}`;
};

// targets: [{ file, content }] with absolute paths. Writes the files whose
// content changed, or with check exits 1 naming them and how to regenerate them.
export function writeOrCheck(targets: readonly ProjectionTarget[], { check }: { check: boolean }): void {
  const stale = targets.filter(({ file, content }) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content);
  if (check) {
    if (stale.length === 0) return;
    console.error(`stale: ${stale.map(({ file }) => display(file)).join(', ')}\nrun: ${regenerateCommand()}`);
    process.exit(1);
  }
  for (const { file, content } of stale) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    console.log(`wrote ${display(file)}`);
  }
}
