// site render: one writeup's body as the build renders it, for previews.
import fs from 'node:fs';
import path from 'node:path';
import { WRITEUPS_FOLDER, vaultRoot } from '../lib/local-paths.ts';
import { renderMarkdown } from '../lib/render.ts';
import { parseFrontmatter } from '../../src/lib/frontmatter.ts';
import { stripArticleChrome, stripRepeatedDescription } from '../../src/lib/writeup-body.ts';
import { EXIT, SiteError, assertSlug, type Output } from './cli.ts';
import type { RenderResult } from './types.ts';

const text = (value: unknown): string => (value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value : '');

// `-` reads the markdown from stdin (an unsaved editor buffer); otherwise the
// slug names a writeup in the vault. The body is what the sync ships (the
// title, hero line, and repeated description stripped). `document` adds the
// full styled preview page, which costs a Vite start (about a second).
export async function render({ slug, document = false, out, stdin = () => fs.readFileSync(0, 'utf8') }: {
  slug: string;
  document?: boolean;
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
  const { data, content } = parseFrontmatter(markdown);
  const { html } = renderMarkdown(stripArticleChrome(stripRepeatedDescription(content, data.description)), 'writeups');
  const result: RenderResult = { slug: slug === '-' ? null : slug, source, html, next: null };
  if (document) {
    const { renderDocument } = await import('../lib/render-document.ts');
    const heroSrc = text(data.cover_image);
    result.document = await renderDocument({
      title: text(data.title) || (slug === '-' ? 'Preview' : slug),
      date: text(data.published_at),
      technologies: Array.isArray(data.technologies) ? data.technologies.map(String) : [],
      ...(heroSrc ? { heroSrc, heroAlt: text(data.cover_alt) } : {}),
      body: html,
    });
  }
  if (!out.json) out.text(result.document ?? html);
  return result;
}
