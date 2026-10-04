// site render: one writeup's body as the build renders it, for previews.
import fs from 'node:fs';
import path from 'node:path';
import { WRITEUPS_FOLDER, vaultRoot } from '../lib/local-paths.ts';
import { renderMarkdown } from '../lib/render.ts';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { EXIT, SiteError, assertSlug, type Output } from './cli.ts';
import type { RenderResult } from './types.ts';

// `-` reads the markdown from stdin (an unsaved editor buffer); otherwise the
// slug names a writeup in the vault.
export async function render({ slug, out, stdin = () => fs.readFileSync(0, 'utf8') }: {
  slug: string;
  out: Output;
  stdin?: () => string;
}): Promise<RenderResult> {
  let markdown: string;
  let source: string;
  if (slug === '-') {
    markdown = stdin();
    source = 'stdin';
  } else {
    assertSlug(slug);
    const file = path.join(vaultRoot(), WRITEUPS_FOLDER, slug, 'index.md');
    if (!fs.existsSync(file)) throw new SiteError(`writeup not found: ${file}`, { code: EXIT.usage, fix: 'check the slug with site writeups' });
    markdown = fs.readFileSync(file, 'utf8');
    source = file;
  }
  const { html } = renderMarkdown(parseFrontmatter(markdown).content, 'writeups');
  if (!out.json) out.text(html);
  return { slug: slug === '-' ? null : slug, source, html, next: null };
}
