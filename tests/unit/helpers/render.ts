// Compiles content the way the build does: Sätteri with the site's plugins,
// as a page or a writeup. `html` returns the rendered HTML; `compile` runs the
// MDX compile content ships through, which is where the guard refuses.
import { pathToFileURL } from 'node:url';
import { markdownToHtml, mdxToJs } from 'satteri';
import { processorOptions } from '../../../src/lib/markdown/index.ts';

export type Collection = 'pages' | 'writeups';
const fileURL = (collection: Collection) => pathToFileURL(`/content/${collection}/doc/index.mdx`);

// The site's plugins are synchronous, so Sätteri returns the result directly.
export function html(markdown: string, collection: Collection = 'writeups'): string {
  const result = markdownToHtml(markdown, { ...processorOptions, fileURL: fileURL(collection) });
  if (result instanceof Promise) throw new Error('a content plugin went async');
  return result.html;
}

// Whitespace between block tags is dropped; inline whitespace is content.
export const render = (markdown: string, collection: Collection = 'writeups'): string => html(markdown, collection).replace(/>\n+</g, '><').trim();

export function compile(markdown: string, collection: Collection = 'writeups'): void {
  mdxToJs(markdown, { ...processorOptions, fileURL: fileURL(collection) });
}
