// Compiles content as the build does. `compile` runs the MDX compile, where the guard refuses.
import { mdxToJs } from 'satteri';
import { contentFileURL, renderMarkdown, type Collection } from '../../../bin/lib/render.ts';
import { processorOptions } from '../../../src/lib/markdown/index.ts';

export type { Collection };

export const html = (markdown: string, collection: Collection = 'writeups'): string => renderMarkdown(markdown, collection).html;

// Whitespace between block tags is dropped; inline whitespace is content.
export const render = (markdown: string, collection: Collection = 'writeups'): string => html(markdown, collection).replace(/>\n+</g, '><').trim();

export function compile(markdown: string, collection: Collection = 'writeups'): void {
  mdxToJs(markdown, { ...processorOptions, fileURL: contentFileURL(collection) });
}
