// Reads src/content straight from disk for code outside Astro's content layer.
import fs from 'node:fs';
import path from 'node:path';
import { parseFrontmatter, type ParsedFrontmatter } from './frontmatter.ts';
import { siteRoot } from './site-root.ts';

export interface SnapshotWriteup extends ParsedFrontmatter {
  slug: string;
  source: string;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export const DOCUMENT_FILE = 'index.mdx';

function documentSlugs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, DOCUMENT_FILE)))
    .map((entry) => entry.name)
    .sort(byName);
}

export function snapshotWriteups(root = siteRoot): SnapshotWriteup[] {
  const dir = path.join(root, 'src/content/writeups');
  return documentSlugs(dir).map((slug) => {
    const source = fs.readFileSync(path.join(dir, slug, DOCUMENT_FILE), 'utf8');
    return { slug, source, ...parseFrontmatter(source) };
  });
}

export const snapshotPageSlugs = (root = siteRoot): string[] => documentSlugs(path.join(root, 'src/content/pages'));
