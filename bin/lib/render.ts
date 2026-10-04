// The build's markdown render as a library call: Sätteri with the site's
// plugins, so previews (the Obsidian plugin, HQ) and tests see exactly what
// the build ships.
import { pathToFileURL } from 'node:url';
import { markdownToHtml } from 'satteri';
import { processorOptions } from '../../src/lib/markdown/index.ts';

export type Collection = 'pages' | 'writeups';

export const contentFileURL = (collection: Collection): URL => pathToFileURL(`/content/${collection}/doc/index.mdx`);

// The site's plugins are synchronous, so Sätteri returns the result directly.
export function renderMarkdown(markdown: string, collection: Collection = 'writeups'): { html: string } {
  const result = markdownToHtml(markdown, { ...processorOptions, fileURL: contentFileURL(collection) });
  if (result instanceof Promise) throw new Error('a content plugin went async');
  return { html: result.html };
}
