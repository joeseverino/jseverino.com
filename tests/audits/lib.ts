// Shared plumbing for the audits. Every audit ends through finish(): the
// problems under one heading and exit 1, or the aligned `ok` summary line the
// gates print. The post-build audits read the build through builtPages(),
// which resolves the outDir from src/lib/build-output.ts and enforces the
// zero-pages floor: an empty or stale outDir fails as a broken build.
import fs from 'node:fs';
import path from 'node:path';
import { resolveBuiltDir } from '../../src/lib/build-output.ts';
import { siteRoot } from '../../src/lib/site-root.ts';
import { walkFiles } from '../../src/lib/walk.ts';
import { fallbackFiles, readRoutes } from '../../bin/lib/pages-routes.ts';

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

// Stops an audit that cannot go on.
export function abort(auditName: string, message: string): never {
  console.error(`${auditName}: ${message}`);
  process.exit(1);
}

export interface BuiltPage {
  file: string;
  rel: string;
  html: string;
}

// The static fallback pages under excluded prefixes are not site pages;
// check-routes audits them on their own.
function staticFallbacks(distDir: string): string[] {
  const routesFile = path.join(distDir, '_routes.json');
  return fs.existsSync(routesFile) ? fallbackFiles(readRoutes(routesFile)).map((file) => file.split('/').join(path.sep)) : [];
}

export function builtPages(auditName: string): { distDir: string; pages: BuiltPage[] } {
  const distDir = resolveBuiltDir(siteRoot) ?? abort(auditName, 'no build output found. Run `astro build` first.');
  const fallbacks = new Set(staticFallbacks(distDir));
  const pages = walkFiles(distDir, { filter: (file) => file.endsWith('.html') && !fallbacks.has(path.relative(distDir, file)) })
    .map((file) => ({ file, rel: path.relative(distDir, file), html: fs.readFileSync(file, 'utf8') }));
  if (pages.length === 0) abort(auditName, `no HTML pages found in ${path.relative(siteRoot, distDir)}. Run the build first.`);
  return { distDir, pages };
}
