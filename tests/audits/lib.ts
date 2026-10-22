// Shared audit plumbing. finish() exits 1 with problems under one heading and the fix, or prints the `ok` line;
// builtPages() fails an empty or stale outDir as a broken build.
import fs from 'node:fs';
import path from 'node:path';
import type { HastNode } from 'satteri';
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

export function builtPages(auditName: string): { distDir: string; pages: BuiltPage[] } {
  const distDir = resolveBuiltDir(siteRoot) ?? abort(auditName, 'no build output found. Run `astro build` first.');
  const pages = fs.readdirSync(distDir, { recursive: true, encoding: 'utf8' })
    .filter((rel) => rel.endsWith('.html'))
    .map((rel) => {
      const file = path.join(distDir, rel);
      return { file, rel, html: fs.readFileSync(file, 'utf8') };
    });
  if (pages.length === 0) abort(auditName, `no HTML pages found in ${path.relative(siteRoot, distDir)}. Run the build first.`);
  return { distDir, pages };
}

type Element = Extract<HastNode, { type: 'element' }>;

// Every element with this tag name, in document order, from a parseHtml() tree.
export const elementsNamed = (node: HastNode, tagName: string): Element[] => [
  ...(node.type === 'element' && node.tagName === tagName ? [node] : []),
  ...('children' in node ? node.children.flatMap((child) => elementsNamed(child, tagName)) : []),
];

// The raw text of an element whose content is text only, such as <script>.
export const rawText = (element: Element): string =>
  element.children.map((child) => (child.type === 'text' ? child.value : '')).join('');
