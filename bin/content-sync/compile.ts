// Compiles a document with the site's renderer, so a problem the build would
// hit (an MDX syntax error, a block the vocabulary lacks, content the guard
// refuses) is reported by site validate first, with its line.
import { mdxToJs } from 'satteri';
import { pathToFileURL } from 'node:url';
import { processorOptions } from '../../src/lib/markdown/index.ts';

export function compileIssues(body: string, collection: 'pages' | 'writeups'): string[] {
  try {
    mdxToJs(body, { ...processorOptions, fileURL: pathToFileURL(`/${collection}/document/index.mdx`) });
    return [];
  } catch (error) {
    return [String((error as Error).message).split('\n')[0] ?? 'does not compile'];
  }
}
