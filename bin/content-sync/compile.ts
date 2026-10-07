// Compiles a document with the site's renderer so build problems surface in site validate first, with a line.
import { mdxToJs } from 'satteri';
import { pathToFileURL } from 'node:url';
import { processorOptions } from '../../src/lib/markdown/index.ts';
import { errorMessage } from '../../src/lib/error-message.ts';

export function compileIssues(body: string, collection: 'pages' | 'writeups'): string[] {
  try {
    mdxToJs(body, { ...processorOptions, fileURL: pathToFileURL(`/${collection}/document/index.mdx`) });
    return [];
  } catch (error) {
    return [errorMessage(error).split('\n')[0] ?? 'does not compile'];
  }
}
