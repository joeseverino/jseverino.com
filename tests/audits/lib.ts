// Shared audit plumbing. finish() exits 1 with problems under one heading or prints the `ok` line;
// builtPages() fails an empty or stale outDir as a broken build.
import fs from 'node:fs';
import path from 'node:path';
import { resolveBuiltDir } from '../../src/lib/build-output.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { walkFiles } from '../../src/lib/walk.ts';

export { siteRoot };

export interface FinishOptions {
  heading?: string;
  bullet?: string;
  fix?: string;
}

export function finish(problems: readonly string[], ok: string, { heading, bullet = '  ', fix }: FinishOptions = {}): void {
  if (problems.length > 0) {
    if (heading) console.error(heading);
    for (const problem of problems) console.error(`${bullet}${problem}`);
    if (fix) console.error(fix);
    process.exit(1);
  }
  console.log(`ok       ${ok}`);
}

export function abort(auditName: string, message: string): never {
  console.error(`${auditName}: ${message}`);
  process.exit(1);
}

export interface BuiltPage {
  file: string;
  rel: string;
  html: string;
}

export function builtPages(auditName: string): { distDir: string; pages: BuiltPage[] } {
  const distDir = resolveBuiltDir(siteRoot) ?? abort(auditName, 'no build output found. Run `astro build` first.');
  const pages = walkFiles(distDir, { filter: (file) => file.endsWith('.html') })
    .map((file) => ({ file, rel: path.relative(distDir, file), html: fs.readFileSync(file, 'utf8') }));
  if (pages.length === 0) abort(auditName, `no HTML pages found in ${path.relative(siteRoot, distDir)}. Run the build first.`);
  return { distDir, pages };
}
