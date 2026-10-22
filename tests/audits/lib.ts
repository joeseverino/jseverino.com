// Shared audit plumbing. finish() exits 1 with problems under one heading and the fix, or prints the `ok` line;
// builtPages() fails an empty or stale outDir as a broken build.
import fs from 'node:fs';
import path from 'node:path';
import { resolveBuiltDir } from '../../src/lib/build-output.ts';
import { siteRoot } from '../../src/lib/site-root.ts';

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

export function abort(auditName: string, message: string, fix?: string): never {
  console.error(`${auditName}: ${message}`);
  if (fix) console.error(fix);
  process.exit(1);
}

export interface BuiltPage {
  file: string;
  rel: string;
  html: string;
}

// One walk of the outDir: every emitted file by its path from the outDir, and the HTML pages read.
export function builtPages(auditName: string): { distDir: string; files: string[]; pages: BuiltPage[] } {
  const distDir = resolveBuiltDir(siteRoot) ?? abort(auditName, 'no build output found. Run `astro build` first.');
  const files = fs.readdirSync(distDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(distDir, path.join(entry.parentPath, entry.name)));
  const pages = files
    .filter((rel) => rel.endsWith('.html'))
    .map((rel) => {
      const file = path.join(distDir, rel);
      return { file, rel, html: fs.readFileSync(file, 'utf8') };
    });
  if (pages.length === 0) abort(auditName, `no HTML pages found in ${path.relative(siteRoot, distDir)}. Run the build first.`);
  return { distDir, files, pages };
}
