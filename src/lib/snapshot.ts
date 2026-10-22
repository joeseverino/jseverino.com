// Reads the content root the build reads (src/content, or SITE_CONTENT_ROOT's tree) straight from
// disk, for code outside Astro's content layer.
import fs from 'node:fs';
import path from 'node:path';
import { contentRoot } from './content-root.ts';
import { parseFrontmatter, type ParsedFrontmatter } from './frontmatter.ts';
import { siteRoot } from './site-root.ts';

export interface SnapshotWriteup extends ParsedFrontmatter {
  slug: string;
  source: string;
}

export const DOCUMENT_FILE = 'index.mdx';
const content = path.resolve(siteRoot, contentRoot);

function documentSlugs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, DOCUMENT_FILE)))
    .map((entry) => entry.name)
    .sort();
}

export function snapshotWriteups(): SnapshotWriteup[] {
  const dir = path.join(content, 'writeups');
  return documentSlugs(dir).map((slug) => {
    const source = fs.readFileSync(path.join(dir, slug, DOCUMENT_FILE), 'utf8');
    return { slug, source, ...parseFrontmatter(source) };
  });
}

export const snapshotPageSlugs = (): string[] => documentSlugs(path.join(content, 'pages'));
